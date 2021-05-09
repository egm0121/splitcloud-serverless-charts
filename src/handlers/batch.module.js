/* eslint-disable no-await-in-loop */
import PostGenerator from 'egm0121-rn-common-lib/modules/IGPostGenerator';
import DeviceReports from '../modules/deviceReports';
import ScreenshotConfig from '../../key/getScreenshots.json';
import SoundCloudChartsService from '../modules/SoundCloudChartsService';
import RawEventsExtractor from '../modules/RawEventsExtractor';
import AthenaQueryClient from '../modules/AthenaQueryClient';

const moment = require('moment');
const { metricScope } = require('aws-embedded-metrics');
const chartService = require('../modules/chartsService');
const selectActiveStreamToken = require('../modules/activeStreamToken');
const discoveryApi = require('../modules/discoverApi');
const helpers = require('../modules/helpers');
const constants = require('../constants/constants');

const weekOfYear = moment().isoWeek();
const { APP_BUCKET } = process.env;
const {
  ATHENA_SPLITCLOUD_WRAPPED_DATABASE,
  WRAPPED_EVENT_TABLE_PREFIX,
  WRAPPED_TOP_TRACKS_TABLE_PREFIX,
} = constants;

/**
 * builds the whitelist of deviceIds that are being active enough
 * to compute the top played track for the year.
 */
module.exports.wrappedPlaylistDevices = async () => {
  // count as active any device with at least 15 tracks across playback sides in the last 3months
  const activeDevices = await DeviceReports.getActiveDevices(15, undefined, '90daysAgo');
  console.log('total active devices:', activeDevices.length);
  const currentYear = new Date().getUTCFullYear().toString();
  try {
    await helpers.saveFileToS3(
      `charts/wrapped/${currentYear}/wrappedDeviceList.json`,
      activeDevices.map(row => row.dimensions[0])
    );
  } catch (err) {
    console.error('wrapped playlist device list write failure:', err.message);
  }
};

module.exports.computeWrappedAggregateTable = async () => {
  const athenaClient = new AthenaQueryClient({
    db: ATHENA_SPLITCLOUD_WRAPPED_DATABASE,
  });
  const currYear = new Date().getUTCFullYear();
  const rawEventTableName = `${WRAPPED_EVENT_TABLE_PREFIX}${currYear}`;
  const topTracksMaterializedTable = `${WRAPPED_TOP_TRACKS_TABLE_PREFIX}${currYear}`;
  // drop older CTAS table if exists to make sure that the materialized view is updated.
  try {
    await athenaClient.executeQuery(`DROP TABLE IF EXISTS ${topTracksMaterializedTable}`);
  } catch (err) {
    console.error('drop wrapped table failure...');
  }
  try {
    const databaseCreation = await athenaClient.executeQuery(
      `CREATE DATABASE IF NOT EXISTS ${ATHENA_SPLITCLOUD_WRAPPED_DATABASE}`
    );
    const rawEventsTable = await athenaClient.executeQuery(`CREATE EXTERNAL TABLE IF NOT EXISTS ${rawEventTableName} (
      \`datetime\` string,
      \`device_id\` string,
      \`device_side\` string,
      \`music_provider\` string,
      \`song_id\` string,
      \`playback_mode\` string,
      \`country_code\` string,
      \`eventTotal\` int
     )
    ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
    LOCATION 's3://${APP_BUCKET}/events/raw/events/PLAYBACK-COMPLETED/${currYear}'
    tblproperties ("skip.header.line.count"="1")
    ;`);
    console.log(`athena table created: ${rawEventTableName}`);
    const topTracksMaterializedView = await athenaClient.executeQuery(`CREATE TABLE IF NOT EXISTS ${topTracksMaterializedTable} AS 
      SELECT SUM(eventtotal) as plays, song_id, device_id, device_side FROM ${rawEventTableName} 
      GROUP BY device_id,device_side,song_id ORDER BY device_id,device_side,plays DESC 
    `);
    console.log(`athena aggregated table created: ${topTracksMaterializedTable}`);
    console.log(
      'athena queries succeded',
      databaseCreation,
      rawEventsTable,
      topTracksMaterializedView
    );
  } catch (err) {
    console.error('Error while computWrappedAggregateTable', err);
  }
};
module.exports.countryChartsPublisher = async () => {
  const topCountryMap = {
    ...constants.TOP_COUNTRIES,
    GLOBAL: 'GLOBAL',
  };
  const countryCodesArr = Object.keys(topCountryMap);
  const promises = countryCodesArr.map(cCode => {
    const cName = topCountryMap[cCode];
    console.log(`send job for country ${cName} queue`, process.env.COUNTRY_CHARTS_QUEUE);
    return helpers.sqs
      .sendMessage({
        DelaySeconds: 5,
        MessageAttributes: {
          countryCode: {
            DataType: 'String',
            StringValue: cCode,
          },
          countryName: {
            DataType: 'String',
            StringValue: cName,
          },
        },
        MessageBody: `Compute top and trending charts for country ${cName}`,
        QueueUrl: process.env.COUNTRY_CHARTS_QUEUE,
      })
      .promise();
  });
  const results = await Promise.all(promises);
  return {
    statusCode: 200,
    body: results,
  };
};
module.exports.countryChartsSubscribe = async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const countryCodeString = messageAttr.countryCode.stringValue;
  const countryNameString = messageAttr.countryName.stringValue;
  console.log('Process country chart request:', { countryCodeString, countryNameString });

  const generateChartsForCountry = async (countryCode, countryName) => {
    try {
      console.log(`Get top and trending charts for ${countryName}...`);
      const isGlobal = countryCode === 'GLOBAL';
      const tracksCount = 100;
      const maybeCountryName = isGlobal ? undefined : countryName;
      const topChartData = await chartService.getTopChart(tracksCount, maybeCountryName);
      const trendingChartData = await chartService.getTrendingChart(
        tracksCount * 2, // fetch twice the songs since we value very recent tracks with low unique plays
        maybeCountryName
      );
      const topRadioStationsData = await chartService.getTopRadioStationsByCountry(
        25,
        maybeCountryName
      );
      const topSearchTerms = await chartService.getTopSearchTermsByCountry(3, maybeCountryName);
      await helpers.saveFileToS3(
        `charts/radios/weekly_popular_country_${countryCode}.json`,
        topRadioStationsData
      );
      await helpers.saveFileToS3(
        {
          bucket: APP_BUCKET,
          keyName: `charts/searchterms/country/weekly_popular_country_${countryCode}.json`,
        },
        topSearchTerms
      );
      if (!topChartData.length && !trendingChartData.length) {
        console.log(`Empty charts, skip country ${countryCode}`);
        return false;
      }
      console.log(`Save to s3 top and trending charts for ${countryName}...`);
      await helpers.saveFileToS3(
        `charts/country/weekly_popular_country_${countryCode}.json`,
        topChartData
      );
      await helpers.saveFileToS3(
        `charts/country/weekly_trending_country_${countryCode}.json`,
        trendingChartData
      );
      await helpers.saveFileToS3(
        `charts/country/history/popular_country_${countryCode}_${weekOfYear}.json`,
        topChartData
      );
      await helpers.pushToTopic(
        {
          MessageBody: `country charts created successfully for ${countryName}`,
          MessageAttributes: {
            countryCode: {
              DataType: 'String',
              StringValue: countryCode,
            },
            countryName: {
              DataType: 'String',
              StringValue: countryName,
            },
          },
        },
        process.env.CHART_CREATED_TOPIC
      );
    } catch (err) {
      console.log(`error while updating country(${countryCode}) charts:`, err);
      if (err.message.indexOf('service is currently unavailable') > -1) {
        console.log('GA report failed, mark message as failed');
        throw err;
      }
    }
    return true;
  };

  const success = await generateChartsForCountry(countryCodeString, countryNameString);
  if (!success) {
    return {
      statusCode: 204,
      error: {
        message: `empty charts, will skip country ${countryCodeString}`,
      },
    };
  }
  return {
    statusCode: 200,
    body: {
      countryCodeString,
    },
  };
};

module.exports.scChartsCache = async () => {
  // TODO: reimplement alternative with track resolve
  let chartData = await SoundCloudChartsService.getTrendingChart();
  await helpers.saveFileToS3(`charts/soundcloud/weekly_trending.json`, chartData);
  chartData = await SoundCloudChartsService.getPopularChart();
  await helpers.saveFileToS3(`charts/soundcloud/weekly_popular.json`, chartData);
  return true;
};
module.exports.wrappedCountriesCharts = async () => {
  const topCountryMap = Object.keys(constants.YEAR_WRAPPED_COUNTRIES);
  const currYear = new Date().getFullYear();
  // eslint-disable-next-line no-restricted-syntax, prefer-const
  for (let countryCode of topCountryMap) {
    try {
      const countryName = constants.YEAR_WRAPPED_COUNTRIES[countryCode];
      console.log(`calculate top of year ${currYear} for country ${countryName}`);
      const topTracks = await chartService.getYearlyPopularTrackByCountry(10, countryName);
      await helpers.saveFileToS3(
        `charts/wrapped_country/${currYear}/wrapped_${countryCode}.json`,
        topTracks
      );
    } catch (err) {
      console.error(`Failed generation country: ${countryCode}, err: ${err.message}`);
    }
  }

  return {
    statusCode: 200,
  };
};
module.exports.selectActiveToken = metricScope(metrics => async () => {
  const newToken = await selectActiveStreamToken(metrics);
  return {
    statusCode: 200,
    body: {
      success: true,
      token: newToken,
    },
  };
});

module.exports.updateDiscoveryApi = async () => {
  /** DISCOVER CUSTOM PLAYLIST PAYLOAD
   * [
   *  {
   *   "sectionName" : "SplitCloud Spotlight",
   *   "sectionDescription": "Exclusive playlists selected by SplitCloud",
   *   "playlists" : [951719269,810462237,720814749]
   *  }
   * ]
   */
  const splitcloudSections = await helpers.readJSONFromS3('app/discover_playlists_payload.json');
  const discovery = await discoveryApi(splitcloudSections);
  return {
    statusCode: 200,
    body: {
      success: true,
      discovery,
    },
  };
};

module.exports.generateChartsPosts = async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const countryCodeString = messageAttr.countryCode.stringValue;
  const postGenerator = new PostGenerator({
    apiKey: ScreenshotConfig.API_KEY,
  });
  console.log('generatePopular & trending posts for:', countryCodeString);
  const [[generatePopularImage], [generateTrendingImage]] = await Promise.all([
    postGenerator.generateChartPostsForCountries([countryCodeString], 'popular'),
    postGenerator.generateChartPostsForCountries([countryCodeString], 'trending'),
  ]);
  const storeToS3Popular = helpers.saveBlobToS3(
    `posts/popular/country_${generatePopularImage.countryCode}.png`,
    generatePopularImage.blob,
    'image/png'
  );
  const storeToS3Trending = helpers.saveBlobToS3(
    `posts/trending/country_${generateTrendingImage.countryCode}.png`,
    generateTrendingImage.blob,
    'image/png'
  );
  const result = await Promise.all([storeToS3Popular, storeToS3Trending]);
  return {
    statusCode: 200,
    body: {
      success: true,
      result,
    },
  };
};

module.exports.referrerPromoSub = metricScope(metrics => async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const referrerId = messageAttr.referrerId.stringValue;
  let promoCodesList = [];
  try {
    promoCodesList = await helpers.readJSONFromS3({
      bucket: APP_BUCKET,
      keyName: 'promocodes/list.json',
    });
  } catch (err) {
    console.error('no promocodes list available!');
  }
  if (!promoCodesList.length) {
    console.error(`No more promocode to assign to ${referrerId}`);
    return { statusCode: 500, body: { success: false } };
  }
  const selectedCode = promoCodesList.pop();
  console.log(`got promocode ${selectedCode}, will assign to ${referrerId}`);
  metrics.putMetric('promocodeListLenght', promoCodesList.length);
  await helpers.saveFileToS3(
    {
      bucket: APP_BUCKET,
      keyName: `promocodes/list.json`,
    },
    promoCodesList
  );
  let rewardedReferralMap = {};
  try {
    rewardedReferralMap = await helpers.readJSONFromS3(`referrers/rewarded/devicemap.json`);
  } catch (err) {
    console.error(`No devicemap found`);
  }
  rewardedReferralMap[referrerId] = selectedCode;
  const result = await helpers.saveFileToS3(
    `referrers/rewarded/devicemap.json`,
    rewardedReferralMap
  );
  console.log('saved updated referral promocodes map');
  return {
    statusCode: 200,
    body: {
      success: true,
      result,
    },
  };
});

module.exports.rawGaEventExtractor = async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const targetDateStr = messageAttr.targetDate.stringValue;
  const eventActionStr = messageAttr.eventAction.stringValue;
  const parsedDate = new Date(targetDateStr);
  console.log(`extracting all event of type ${eventActionStr} for date: ${targetDateStr}`);
  if (!eventActionStr || !targetDateStr) return false;
  const rawEvents = await RawEventsExtractor.fetchDailyEvents(targetDateStr, eventActionStr);
  const csvData = rawEvents.map(res => res.dimensions.concat(res.metrics).join(',')).join('\n');
  const result = await helpers.saveFileToS3(
    {
      bucket: APP_BUCKET,
      keyName: `events/raw/events/${eventActionStr}/${parsedDate.getFullYear()}/${targetDateStr}.csv`,
    },
    csvData,
    false
  );
  return {
    statusCode: 200,
    body: {
      success: true,
      result,
    },
  };
};

const pushEventIngestionJob = async (targetDate, eventName = 'PLAYBACK-COMPLETED') =>
  helpers.sqs
    .sendMessage({
      DelaySeconds: 5,
      MessageAttributes: {
        targetDate: {
          DataType: 'String',
          StringValue: targetDate,
        },
        eventAction: {
          DataType: 'String',
          StringValue: eventName,
        },
      },
      MessageBody: `pushEventIngestionJob ${targetDate} - ${eventName}`,
      QueueUrl: process.env.GA_EXTRACTOR_QUEUE,
    })
    .promise();

module.exports.dailyGaEventExtract = async () => {
  const yesterdayDate = new Date();
  const dayInMillis = 24 * 60 * 60 * 1e3;
  yesterdayDate.setTime(yesterdayDate.getTime() - 1 * dayInMillis);
  const toFormattedDate = helpers.formatToISODate(yesterdayDate);
  const queueMsg = await pushEventIngestionJob(toFormattedDate);
  return {
    statusCode: 200,
    body: queueMsg,
  };
};

module.exports.historyGaEventExtract = async () => {
  const yesterdayDate = new Date();
  const dayInMillis = 24 * 60 * 60 * 1e3;
  yesterdayDate.setTime(yesterdayDate.getTime() - 1 * dayInMillis);
  const yesterDayMillis = yesterdayDate.getTime();
  const sinceDate = new Date();
  sinceDate.setUTCMonth(0);
  sinceDate.setUTCDate(1);
  let sinceDateMillis = sinceDate.getTime();
  while (sinceDateMillis < yesterDayMillis) {
    const currDayDate = helpers.formatToISODate(new Date(sinceDateMillis));
    console.log(`ingest historical ga events for ${currDayDate}`);
    await pushEventIngestionJob(currDayDate);
    sinceDateMillis += dayInMillis;
  }
  return {
    statusCode: 200,
  };
};
