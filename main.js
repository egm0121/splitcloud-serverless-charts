import RadioApi from './radioApi';

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
  console.log('messages x invoke', event.Records.length);
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
  let clientCountry =
    helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];
  const playlistKind = event.queryStringParameters.kind;
  if (!['popular', 'trending'].includes(playlistKind)) {
    callback(null, {
      statusCode: 400,
    });
    return;
  }
  const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
  if (!hasCountryPlaylist) {
    clientCountry = 'GLOBAL';
  }
  const playlistFilename = `charts/country/weekly_${playlistKind}_country_${clientCountry}.json`;

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
  const logDataJson = JSON.parse(event.body);
  let logStr = '';
  logStr += logDataJson.deviceInfo.join('\n');
  logStr += '\nLOGS\n';
  logStr += logDataJson.deviceLogs.join('\n');
  // eslint-disable-next-line prettier/prettier
  const [date, time] = (new Date()).toISOString().split('T');
  const timeNoMillis = time.split('.')[0];
  await saveToS3(`feedback_logs/${date}/${deviceid}-${timeNoMillis}.log`, logStr, false);
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
/**
 *  /cta/{deviceId}/{side}
 */
module.exports.ctaEndpoint = async (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  // if (isAndroidId) {
  //   return callback(null, {
  //     statusCode: 200,
  //     headers: {
  //       ...corsHeaders,
  //     },
  //     body: JSON.stringify({
  //       ctaLabel: '❗️Last Day 🔑 FREE Giveaway!',
  //       ctaUrl: 'http://www.splitcloud-app.com/giveaway.html',
  //     }),
  //   });
  // }
  return callback(null, {
    statusCode: 204,
    headers: {
      ...corsHeaders,
    },
  });
};

/**
 * [POST] /explore/related
 */
module.exports.exploreRelated = async (event, context, callback) => {
  const sourceTrackIds = JSON.parse(event.body) || [];
  if (!sourceTrackIds.length) {
    return callback(null, {
      statusCode: 204,
      headers: {
        ...corsHeaders,
      },
    });
  }
  const allRelatedReq = sourceTrackIds.map(trackId => chartService.fetchRelatedTracksById(trackId));
  const responsesArr = await Promise.all(allRelatedReq);
  const relatedTrackList = responsesArr.reduce((acc, resp) => {
    const oneTrackRelatedArr = resp.data;
    acc.push(...oneTrackRelatedArr);
    return acc;
  }, []);
  helpers.arrayInPlaceShuffle(relatedTrackList);
  return callback(null, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
    },
    body: JSON.stringify(relatedTrackList),
  });
};
