/* eslint-disable no-await-in-loop */
import PostGenerator from 'egm0121-rn-common-lib/modules/IGPostGenerator';
import DeviceReports from '../modules/deviceReports';
import ScreenshotConfig from '../../key/getScreenshots.json';

const moment = require('moment');
const { metricScope } = require('aws-embedded-metrics');
const chartService = require('../modules/chartsService');
const selectActiveStreamToken = require('../modules/activeStreamToken');
const discoveryApi = require('../modules/discoverApi');
const helpers = require('../modules/helpers');
const constants = require('../constants/constants');

const weekOfYear = moment().isoWeek();
const saveToS3 = helpers.saveFileToS3;

module.exports.wrappedPlaylistPublisher = async () => {
  // count as active any device with at least 15 tracks across playback sides in the last 3months
  const activeDevices = await DeviceReports.getActiveDevices(15, undefined, '90daysAgo');
  console.log('total active devices:', activeDevices.length);
  const currentYear = new Date().getUTCFullYear().toString();
  try {
    await saveToS3(
      `charts/wrapped/${currentYear}/wrappedDeviceList.json`,
      activeDevices.map(row => row.dimensions[0])
    );
  } catch (err) {
    console.error('wrapped playlist device list write failure:', err.message);
  }
  const writeMessages = activeDevices.map(row => {
    const deviceId = row.dimensions[0];
    console.log('adding to wrapped queue:', deviceId);
    return helpers.sqs
      .sendMessage({
        DelaySeconds: 5,
        MessageAttributes: {
          deviceId: {
            DataType: 'String',
            StringValue: deviceId,
          },
          currentYear: {
            DataType: 'String',
            StringValue: currentYear,
          },
        },
        MessageBody: `Generate wrapped playlist for device: ${deviceId}`,
        QueueUrl: process.env.WRAPPED_BUFFER_QUEUE,
      })
      .promise();
  });
  const enquedMessages = await Promise.all(writeMessages);
  return {
    success: true,
    totalDevices: activeDevices.length,
    enquedMessages,
  };
};
const chunkMessageMover = async (sourceQueue, destQueue, MAX_MESSAGES_CHUNK = 600) => {
  console.log(
    'chunkMessageMover started from queue',
    sourceQueue,
    'to queue',
    destQueue,
    'max messages',
    MAX_MESSAGES_CHUNK
  );
  const maxMessageIterator = new Array(MAX_MESSAGES_CHUNK).fill(1).map((v, k) => k);
  // eslint-disable-next-line no-restricted-syntax
  for (let i of maxMessageIterator) {
    // eslint-disable-next-line no-await-in-loop
    const response = await helpers.sqs
      .receiveMessage({
        QueueUrl: sourceQueue,
        MaxNumberOfMessages: 1,
        MessageAttributeNames: ['.*'],
      })
      .promise();
    if (!response.Messages) {
      console.log('empty receive', i);
    } else {
      const messageAttr = response.Messages[0].MessageAttributes;
      const messageBody = response.Messages[0].Body;
      const receiptForDelete = response.Messages[0].ReceiptHandle;
      const deviceId = messageAttr.deviceId.StringValue;
      const currentYear = messageAttr.currentYear.StringValue;
      // eslint-disable-next-line no-await-in-loop
      await helpers.sqs
        .sendMessage({
          MessageAttributes: {
            deviceId: {
              DataType: 'String',
              StringValue: deviceId,
            },
            currentYear: {
              DataType: 'String',
              StringValue: currentYear,
            },
          },
          MessageBody: messageBody,
          QueueUrl: destQueue,
        })
        .promise();
      console.log('pushed message from ', sourceQueue, ':', i, ' for device:', deviceId);
      // eslint-disable-next-line no-await-in-loop
      await helpers.sqs
        .deleteMessage({
          QueueUrl: sourceQueue,
          ReceiptHandle: receiptForDelete,
        })
        .promise();
    }
  }
};
module.exports.wrappedChunkPublisher = async () => {
  return chunkMessageMover(process.env.WRAPPED_BUFFER_QUEUE, process.env.WRAPPED_PLAYLIST_QUEUE);
};
module.exports.wrappedDeadQueuePublisher = async () => {
  return chunkMessageMover(
    process.env.WRAPPED_PLAYLIST_DEAD_QUEUE,
    process.env.WRAPPED_PLAYLIST_QUEUE
  );
};
const computeAndStoreWrappedSidePlaylist = async (side, deviceId, currentYear) => {
  console.log('Process wrapped playlist message:', { deviceId, currentYear });
  const playlistFileName = `charts/wrapped/${currentYear}/${deviceId}_${side}.json`;
  const trackList = await chartService.getYearlyPopularTrackByDeviceId(10, deviceId, side);
  if (trackList.length) {
    await saveToS3(playlistFileName, trackList);
    return true;
  }
  console.log(`empty tracklist detected: ${deviceId}-${side}`);
  return false;
};
const wrappedPlaylistSubscribe = metricScope(metrics => async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const deviceId = messageAttr.deviceId.StringValue || messageAttr.deviceId.stringValue;
  const currYear = messageAttr.currentYear.StringValue || messageAttr.currentYear.stringValue;
  const sideL = await computeAndStoreWrappedSidePlaylist('L', deviceId, currYear);
  const sideR = await computeAndStoreWrappedSidePlaylist('R', deviceId, currYear);
  [sideL, sideR].filter(e => !e).forEach(() => metrics.putMetric('wrappedPlaylistEmpty', 1));
  return true;
});
module.exports.wrappedPlaylistSubscribe = wrappedPlaylistSubscribe;
const waitFor = secs => new Promise(res => setTimeout(res, secs * 1e3));

module.exports.serialWrappedProcessor = async (event, context) => {
  const sourceQueue = process.env.WRAPPED_PLAYLIST_QUEUE;
  let execTimeLeft = Math.round(context.getRemainingTimeInMillis() / 1000);
  let emptyReceive = 0;
  while (execTimeLeft > 120 && emptyReceive < 3) {
    const messageResponse = await helpers.sqs
      .receiveMessage({
        QueueUrl: sourceQueue,
        MaxNumberOfMessages: 1,
        MessageAttributeNames: ['.*'],
      })
      .promise();
    if (!messageResponse.Messages) {
      console.log('empty receive wait 10 seconds');
      await waitFor(10);
      emptyReceive += 1;
    } else {
      const messageAttributes = messageResponse.Messages[0].MessageAttributes;
      const receiptForDelete = messageResponse.Messages[0].ReceiptHandle;
      console.log('processing message', messageAttributes);
      try {
        await wrappedPlaylistSubscribe({ Records: [{ messageAttributes }] });
      } catch (err) {
        console.log('processing of message failed:', err);
      }
      // eslint-disable-next-line no-await-in-loop
      await helpers.sqs
        .deleteMessage({
          QueueUrl: sourceQueue,
          ReceiptHandle: receiptForDelete,
        })
        .promise();
    }
    execTimeLeft = Math.round(context.getRemainingTimeInMillis() / 1000);
  }
  console.log('exiting work loop, only', execTimeLeft, 'secs left, emptyreceives', emptyReceive);
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
      if (!topChartData.length && !trendingChartData.length) {
        console.log(`Empty charts, skip country ${countryCode}`);
        return false;
      }
      console.log(`Save to s3 top and trending charts for ${countryName}...`);
      await saveToS3(`charts/country/weekly_popular_country_${countryCode}.json`, topChartData);
      await saveToS3(
        `charts/country/weekly_trending_country_${countryCode}.json`,
        trendingChartData
      );
      await saveToS3(
        `charts/country/history/popular_country_${countryCode}_${weekOfYear}.json`,
        topChartData
      );
      await saveToS3(
        `charts/radios/weekly_popular_country_${countryCode}.json`,
        topRadioStationsData
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
  const chartData = await chartService.getScTrendingChart();
  await saveToS3(`charts/soundcloud/weekly_trending.json`, chartData);
  return true;
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
  const { APP_BUCKET } = process.env;
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
