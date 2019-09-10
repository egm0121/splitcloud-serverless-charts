
const moment = require('moment');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoveryApi = require('./discoverApi');
const helpers = require('./helpers');
const constants = require('./constants');

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

module.exports.updateCountryCharts = async () => {
  console.log('Splitcloud-serverless-charts updateCountyCharts');
  const countryCodesArr = Object.keys(constants.TOP_COUNTRIES);
  const generateChartsForCountry = async countryCode  => {
    const countryName = constants.TOP_COUNTRIES[countryCode];
    try {
      console.log(`Get top and trending charts for ${countryName}...`);
      const topChartData = await chartService.getTopChart(75,countryName);
      const trendingChartData = await chartService.getTrendingChart(75,countryName);
      if (topChartData.length && trendingChartData.length) {
        console.log(`Save to s3 top and trending charts for ${countryName}...L:${topChartData.length}`)
        await saveToS3(`charts/weekly_popular_country_${countryCode}.json`, topChartData);
        await saveToS3(`charts/weekly_trending_country_${countryCode}.json`, trendingChartData);
      }
    } catch (err) {
      console.log(`error while updating country(${countryCode}) charts:`, err);
    }
  }
  for(let countryCode of countryCodesArr) {
    await generateChartsForCountry(countryCode);
  }
  console.log('try to store data to s3 file bucketName:', process.env.BUCKET);
  return {
    statusCode: 200,
    body: {
      success: Object.keys(constants.TOP_COUNTRIES),
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
// API methods
module.exports.chartsEndpoint = async (event, context, callback) => {
  const clientCountry = event.headers['CloudFront-Viewer-Country'];
  const playlistKind = event.queryStringParameters.kind;
  if (!['popular', 'trending'].includes(playlistKind)) {
    callback(null, {
      statusCode: 400,
    });
  }
  const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
  const playlistFilename = hasCountryPlaylist
    ? `charts/weekly_${playlistKind}_country_${clientCountry}.json`
    : `charts/weekly_trending.json`;
  console.log('serve playlist from s3', playlistFilename);
  const playlistPayload = await helpers.readFileFromS3(playlistFilename);
  const resp = {
    statusCode: 200,
    body: playlistPayload,
  };
  callback(null, resp);
};
