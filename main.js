import RadioApi from './radioApi';

const semverCompare = require('semver-compare');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoveryApi = require('./discoverApi');
const helpers = require('./helpers');
const constants = require('./constants');
const formatters = require('./formatters');

const saveToS3 = helpers.saveFileToS3;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};
const LATEST_VERSION = '5.7';
const MIN_SUPPORTED_VERSION = '5.6'; // specify M.m without patch to allow matching client versions without patch
const MIN_TRACK_DURATION = 30 * 1e3;

const isUnsupportedVersion = clientVersion => {
  return !clientVersion || semverCompare(clientVersion, MIN_SUPPORTED_VERSION) === -1;
};

const blockUnsupportedVersions = (
  handler,
  errBody = { error: 'unsupported client version' },
  errCode = 400
) => (event, context, callback) => {
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  if (isUnsupportedVersion(clientVersion)) {
    return callback(null, {
      statusCode: errCode,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify(errBody),
    });
  }
  return handler(event, context, callback);
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

module.exports.scChartsCache = async () => {
  const chartData = await chartService.getScTrendingChart();
  await saveToS3(`charts/soundcloud/weekly_trending.json`, chartData);
  return true;
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
module.exports.chartsEndpoint = blockUnsupportedVersions(async (event, context, callback) => {
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
  const playlistPayload = await helpers.readJSONFromS3(playlistFilename);
  const resp = {
    statusCode: 200,
    body: JSON.stringify(formatters.formatTrackListPayload(playlistPayload)),
  };
  callback(null, resp);
});
/**
 * /regions
 */
module.exports.topRegions = blockUnsupportedVersions((event, context, callback) => {
  callback(null, {
    statusCode: 200,
    body: JSON.stringify(constants.TOP_COUNTRIES),
  });
});
/**
 * /radio/countrycodes
 */
module.exports.radioCountryCodes = blockUnsupportedVersions((event, context, callback) => {
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
});
/**
 * not provided appVersion by client until 5.8
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
      body: JSON.stringify(formatters.formatTrackListPayload(trackList)),
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
 *  /app/config
 */
module.exports.appConfigApi = blockUnsupportedVersions(
  async (event, context, callback) => {
    const jsonCacheFileName = `app/app_config_v2.json`;
    let appConfig;
    try {
      appConfig = await helpers.readJSONFromS3(jsonCacheFileName);
    } catch (err) {
      console.warn('failed fetching client config');
    }
    if (appConfig) {
      return callback(null, {
        statusCode: 200,
        headers: {
          ...corsHeaders,
        },
        body: JSON.stringify(appConfig),
      });
    }
  },
  { STREAM_CLIENT_ID: 'invalidtokeninvalidtoken00000000' },
  200
);
const ctaHandleEndOfLife = (event, context, callback) => {
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const { deviceId } = event.pathParameters;
  if (!clientVersion || semverCompare(clientVersion, LATEST_VERSION) === -1) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify({
        ctaLabel: `http://www.splitcloud-app.com/?ref=upgrade&deviceId=${deviceId}`,
        ctaUrl: 'Update SplitCloud Now!',
        ctaButtonColor: '#FF7F50',
      }),
    });
    return true;
  }
  return false;
};

const ctaHandleCountryPromotion = (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  const clientCountry =
    helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];
  if (isAndroidId && clientCountry in constants.COUNTRY_PROMOTION) {
    const promo = constants.COUNTRY_PROMOTION[clientCountry];
    callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify({
        ctaLabel: promo.ctaLabel || '✨Remove Ads - 50% OFF ✨',
        ctaUrl: `${promo.ctaUrl}?country=${clientCountry}&deviceId=${deviceId}`,
        ctaButtonColor: promo.ctaButtonColor || '#da3c3c',
      }),
    });
    return true;
  }
  return false;
};
/**
 *  /cta/{deviceId}/{side}
 */
module.exports.ctaEndpoint = blockUnsupportedVersions(async (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const ctaBgBlue = '#2196F3';
  const ctaLabelA = "Let's be friends 😀";
  const ctaLabelB = 'Follow SplitCloud ✨';

  const selectedVariant = helpers.selectVariantFromHash(deviceId) ? 'A' : 'B';
  const ctaButtonColor = ctaBgBlue;
  const ctaUrl = `http://www.splitcloud-app.com/follow.html?variant=${selectedVariant}&v=2`;
  const ctaLabel = selectedVariant === 'A' ? ctaLabelA : ctaLabelB;
  if (ctaHandleEndOfLife(event, context, callback)) return true;
  if (ctaHandleCountryPromotion(event, context, callback)) return true;
  console.log(
    JSON.stringify({ method: 'ctaEndpoint', metric: `variant_${selectedVariant}`, value: 1 })
  );
  return callback(null, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
    },
    body: JSON.stringify({
      ctaLabel,
      ctaUrl,
      ctaButtonColor,
    }),
  });
});
const getTrackTags = t => {
  if (!t.tag_list) return [];
  let separator = (t.tag_list.indexOf('"') > -1 && '"') || ' ';
  separator = (t.tag_list.indexOf(',') > -1 && ',') || separator;
  const rawTags = t.tag_list.split(separator).filter(tag => tag.length);
  rawTags.push(t.genre);
  return rawTags
    .map(tag => tag && tag.trim().toLowerCase())
    .filter(tag => tag && tag.length > 1 && !(tag in constants.TAGS_BLACKLIST));
};
const roundToWeek = d => {
  d.setHours(0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() - 1));
  return d;
};
const sortByDateDay = (ta, tb) => {
  const dateB = roundToWeek(new Date(tb.created_at));
  const dateA = roundToWeek(new Date(ta.created_at));
  return dateB - dateA;
};
/**
 * [POST] /explore/related
 */
module.exports.exploreRelated = blockUnsupportedVersions(async (event, context, callback) => {
  // eslint-disable-next-line prefer-const
  let allInputTracks = JSON.parse(event.body) || [];
  console.log(JSON.stringify({ logMetric: 'inputTrackNbr', tracksLength: allInputTracks.length }));
  helpers.arrayInPlaceShuffle(allInputTracks); // shuffle input tracks
  let sourceTrackIds = allInputTracks.slice(0, 8); // fetch at most 10 related playlists
  let clientCountry =
    helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];

  const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
  if (!hasCountryPlaylist) clientCountry = 'GLOBAL';
  const playlistFilename = `charts/country/weekly_trending_country_${clientCountry}.json`;
  const playlistPayload = await helpers.readJSONFromS3(playlistFilename);
  const topTrackIds = playlistPayload.slice(0, 10).map(t => t.id);
  console.log(`fetching trending chart for country ${clientCountry}`);
  const fillNbr = 10 - sourceTrackIds.length;
  console.log(
    `use ${sourceTrackIds.length} sourceTracks and ${fillNbr} charts track to generate lists`
  );
  sourceTrackIds = [...sourceTrackIds, ...topTrackIds.slice(0, fillNbr)];
  console.log('final source tracks', sourceTrackIds);
  const allRelatedReq = sourceTrackIds.map(trackId =>
    chartService.fetchRelatedTracksById(trackId).catch(() => Promise.resolve({ data: [] }))
  );
  const responsesArr = await Promise.all(allRelatedReq);
  let relatedTrackList = responsesArr.reduce((acc, resp) => {
    const oneTrackRelatedArr = resp.data;
    acc.push(...oneTrackRelatedArr);
    return acc;
  }, []);

  const uniqueSet = new Set();
  const relatedTagsSet = new Set();
  relatedTrackList = relatedTrackList
    .filter(track => {
      if (uniqueSet.has(track.id)) return false;
      uniqueSet.add(track.id);
      getTrackTags(track).forEach(tag => relatedTagsSet.add(tag));
      return track.duration > MIN_TRACK_DURATION && !allInputTracks.includes(track.id);
    })
    .map(track => {
      // eslint-disable-next-line no-param-reassign
      track.description = '';
      return track;
    });
  const recentSCTracks = await helpers.readJSONFromS3(`charts/soundcloud/weekly_trending.json`);
  const recentRelated = recentSCTracks.filter(t => {
    const hasTagMatch = getTrackTags(t).find(scTag => relatedTagsSet.has(scTag));
    // if tags are matching and track is unique, add it to results
    if (hasTagMatch && !uniqueSet.has(t.id)) {
      console.log(`adding track: ${t.title} because matched tag:`, hasTagMatch);
      return true;
    }
    return false;
  });
  relatedTrackList.push(...recentRelated); // add sc recents tracks relevant for feed
  // order all by recency
  relatedTrackList.sort(sortByDateDay);

  return callback(null, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
    },
    body: JSON.stringify(formatters.formatTrackListPayload(relatedTrackList)),
  });
});
