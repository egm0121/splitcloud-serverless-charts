import RadioApi from './radioApi';

const moment = require('moment');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoveryApi = require('./discoverApi');
const helpers = require('./helpers');
const constants = require('./constants');

const saveToS3 = helpers.saveFileToS3;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

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
  const generateChartsForCountry = async countryCode => {
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
  // eslint-disable-next-line
  for (let countryCode of countryCodesArr) {
    // eslint-disable-next-line no-await-in-loop
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
/**
 *
 * REST API methods
 *
 * * */
/**
 * /regions
 */
module.exports.chartsEndpoint = async (event, context, callback) => {
  const clientCountry =
    helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];
  const playlistKind = event.queryStringParameters.kind;
  if (!['popular', 'trending'].includes(playlistKind)) {
    callback(null, {
      statusCode: 400,
    });
  }
  const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
  const playlistFilename = hasCountryPlaylist
    ? `charts/weekly_${playlistKind}_country_${clientCountry}.json`
    : `charts/weekly_${playlistKind}.json`;
  console.log('serve playlist from s3', playlistFilename);
  const playlistPayload = await helpers.readFileFromS3(playlistFilename);
  const resp = {
    statusCode: 200,
    body: playlistPayload,
  };
  callback(null, resp);
};
/**
 * /regions
 */
module.exports.topRegions = (event, context, callback) => {
  callback(null, {
    statusCode: 200,
    body: JSON.stringify(constants.TOP_COUNTRIES),
  });
};
/**
 * /radio/countrycodes
 */
module.exports.radioCountryCodes = (event, context, callback) => {
  const radioCountryList = constants.RADIO_COUNTRY_CODES;
  const clientCountry =
    helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];
  const currentCountryCode = radioCountryList.find(item => item.value === clientCountry)
    ? clientCountry
    : 'US';
  callback(null, {
    statusCode: 200,
    body: JSON.stringify({
      list: radioCountryList,
      current: currentCountryCode,
    }),
  });
};
/**
 * /radio/list/countrycode/{countrycode}
 */
module.exports.radioListByCountryCode = async (event, context, callback) => {
  const radioInstance = new RadioApi();
  const countryCode = event.pathParameters.countrycode;
  try {
    const stationsBlacklist = constants.STATIONS_BLACKLIST;
    const resp = await radioInstance.getStationsByCountryCode({
      countryCode,
    });
    const radioList = resp.data.filter(station => !stationsBlacklist[station.id]);
    if (constants.STATIONS_CUSTOM[countryCode]) {
      radioList.push(...constants.STATIONS_CUSTOM[countryCode]);
    }
    callback(null, {
      statusCode: 200,
      body: JSON.stringify(radioList),
    });
  } catch (err) {
    callback(null, {
      statusCode: 500,
      body: err.toString(),
    });
  }
};
/**
 * /app/feedback/{deviceid}
 */
module.exports.logCollector = async (event, context, callback) => {
  // eslint-disable-next-line no-unused-vars
  const { deviceid } = event.pathParameters;
  const logDataJson = event.body;
  // eslint-disable-next-line prettier/prettier
  const [date, time] = (new Date()).toISOString().split('T');
  await saveToS3(`feedback_logs/${date}/${deviceid}-${time}.json`, logDataJson, false);
  return callback(null, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
    },
    body: JSON.stringify({ success: true }),
  });
};
/**
 * /wrapped/{year}/{deviceId}/{side}?cache_only=1
 */
module.exports.yearWrappedTopList = async (event, context, callback) => {
  const { year, deviceId, side } = event.pathParameters;
  const fromCacheOnly = helpers.getQueryParam(event, 'cache_only');
  const sideUpper = (side || '').toUpperCase();

  const jsonCacheFileName = `charts/wrapped/${year}/${deviceId}_${sideUpper}.json`;
  let trackList;
  try {
    trackList = await helpers.readJSONFromS3(jsonCacheFileName);
  } catch (err) {
    console.log('no cache found for', jsonCacheFileName, 'generating...');
  }
  if (trackList) {
    return callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify(trackList),
    });
  }
  if (fromCacheOnly) {
    return callback(null, {
      statusCode: 204,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify([]),
    });
  }
  try {
    trackList = await chartService.getPopularTracksByDeviceId(
      10,
      `${year}-01-01`,
      deviceId,
      sideUpper
    );
    if (trackList.length) {
      await saveToS3(jsonCacheFileName, trackList);
    }
    callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify(trackList),
    });
  } catch (error) {
    callback(null, {
      statusCode: 500,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify({ error: error.toString(), trace: error.stack }),
    });
  }
};