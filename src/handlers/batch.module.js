import PostGenerator from 'egm0121-rn-common-lib/modules/IGPostGenerator';
import DeviceReports from '../modules/deviceReports';
import ScreenshotConfig from '../../key/getScreenshots.json';

const { metricScope } = require('aws-embedded-metrics');
const chartService = require('../modules/chartsService');
const selectActiveStreamToken = require('../modules/activeStreamToken');
const discoveryApi = require('../modules/discoverApi');
const helpers = require('../modules/helpers');
const constants = require('../constants/constants');

const saveToS3 = helpers.saveFileToS3;

module.exports.wrappedPlaylistPublisher = async () => {
  const activeDevices = await DeviceReports.getActiveDevices();
  console.log('total active devices:', activeDevices.length);
  const currentYear = new Date().getFullYear().toString();
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
        QueueUrl: process.env.WRAPPED_PLAYLIST_QUEUE,
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
module.exports.wrappedPlaylistSubscribe = metricScope(metrics => async event => {
  const messageAttr = event.Records[0].messageAttributes;
  const deviceId = messageAttr.deviceId.stringValue;
  const currentYear = messageAttr.currentYear.stringValue;
  console.log('Process wrapped playlist message:', { deviceId, currentYear });
  const playlistsSavedPromise = ['L', 'R'].map(async side => {
    const playlistFileName = `charts/wrapped/${currentYear}/${deviceId}_${side}.json`;
    const trackList = await chartService.getPopularTracksByDeviceId(
      25,
      `${currentYear}-01-01`,
      deviceId,
      side
    );
    if (trackList.length) {
      return saveToS3(playlistFileName, trackList);
    }
    console.log(`empty tracklist detected: ${deviceId}-${side}`);
    metrics.putMetric('wrappedPlaylistEmpty', 1);
    return true;
  });
  return Promise.all(playlistsSavedPromise);
});

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

module.exports.generateTrendingPosts = async () => {
  const postGenerator = new PostGenerator({
    apiKey: ScreenshotConfig.API_KEY,
  });
  const generateImages = await postGenerator.generateChartPostsForCountries(
    constants.IG_POST_COUNTRIES,
    'trending'
  );
  const storeToS3Promises = generateImages.map(imageData => {
    return helpers.saveBlobToS3(
      `posts/trending/country_${imageData.countryCode}.png`,
      imageData.blob,
      'image/png'
    );
  });
  const result = await Promise.all(storeToS3Promises);
  return {
    statusCode: 200,
    body: {
      success: true,
      result,
    },
  };
};
module.exports.generatePopularPosts = async () => {
  const postGenerator = new PostGenerator({
    apiKey: ScreenshotConfig.API_KEY,
  });
  const generateImages = await postGenerator.generateChartPostsForCountries(
    constants.IG_POST_COUNTRIES,
    'popular'
  );
  const storeToS3Promises = generateImages.map(imageData => {
    return helpers.saveBlobToS3(
      `posts/popular/country_${imageData.countryCode}.png`,
      imageData.blob,
      'image/png'
    );
  });
  const result = await Promise.all(storeToS3Promises);
  return {
    statusCode: 200,
    body: {
      success: true,
      result,
    },
  };
};
