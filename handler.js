const moment = require('moment');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoveryApi = require('./discoverApi');
const helpers = require('./helpers');

const saveToS3 = helpers.saveFileToS3;

module.exports.hello = async () => {
  console.log('Splitcloud-serverless-charts service was called');
  const topChartData = await chartService.getTopChart();
  const trendingChartData = await chartService.getTrendingChart();
  console.log('try to store data to s3 file bucketName:', process.env.BUCKET);
  let retValue;
  let retValueCopy;
  const weekOfYear = moment().format('W');
  try {
    if (topChartData.length && trendingChartData.length) {
      console.log('Valide response detected, will update charts');
      retValue = await saveToS3('charts/weekly_popular.json', topChartData);
      retValueCopy = await saveToS3(`charts/weekly_trending.json`, trendingChartData);
    }
    await saveToS3(`charts/weekly_popular_${weekOfYear}.json`, topChartData);
    await saveToS3(`charts/weekly_trending_${weekOfYear}.json`, trendingChartData);
  } catch (err) {
    console.log('Uploaded chart to S3 err:', err);
  }
  return {
    statusCode: 200,
    body: {
      success: [retValue, retValueCopy],
    },
  };
};

module.exports.selectActiveToken = async () => {
  const newToken = await selectActiveStreamToken();
  return {
    statusCode: 200,
    body: {
      success: true,
      token: newToken,
    },
  };
};

module.exports.updateDiscoveryApi = async () => {
  const discovery = await discoveryApi();
  return {
    statusCode: 200,
    body: {
      success: true,
      discovery,
    }
  }
}