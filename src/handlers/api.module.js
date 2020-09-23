import RadioApi from '../modules/radioApi';

const { metricScope } = require('aws-embedded-metrics');
const semverCompare = require('semver-compare');
const chartService = require('../modules/chartsService');
const helpers = require('../modules/helpers');
const constants = require('../constants/constants');
const formatters = require('../modules/formatters');

const saveToS3 = helpers.saveFileToS3;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};
const LATEST_VERSION = '5.7';
const MIN_SUPPORTED_VERSION = '5.6'; // specify M.m without patch to allow matching client versions without patch
const MIN_PLAYLIST_IN_CTA_VERSION = '6.0'; // first client version that supports embedding playlist in CTA response
const MIN_TRACK_DURATION = 30 * 1e3;

const isUnsupportedVersion = clientVersion =>
  !clientVersion || semverCompare(clientVersion, MIN_SUPPORTED_VERSION) === -1;

const blockUnsupportedVersions = (
  handler,
  errBody = { error: 'unsupported client version' },
  errCode = 400
) => async (event, context, callback) => {
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
    headers: {
      ...corsHeaders,
    },
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
    headers: { ...corsHeaders },
    body: JSON.stringify(constants.TOP_COUNTRIES),
  });
});
/**
 * /posts/regions
 */
module.exports.postsRegions = blockUnsupportedVersions((event, context, callback) => {
  callback(null, {
    statusCode: 200,
    headers: { ...corsHeaders },
    body: JSON.stringify(constants.IG_POST_COUNTRIES),
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

const getPopularStationsForCountry = cCode => {
  try {
    if (cCode in constants.TOP_COUNTRIES) {
      console.log('get popular stations for country');
      return helpers.readJSONFromS3(`charts/radios/weekly_popular_country_${cCode}.json`);
    }
    return [];
  } catch (err) {
    return [];
  }
};
module.exports.radioListByCountryCode = async (event, context, callback) => {
  const radioInstance = new RadioApi();
  const countryCode = (event.pathParameters.countrycode || '').toUpperCase();
  try {
    const radioListCacheKey = `radio/list/countrycode/${countryCode}.json`;
    let formattedRadioList = await helpers.readS3Cache(radioListCacheKey);
    if (!formattedRadioList) {
      const stationsBlacklist = constants.STATIONS_BLACKLIST;
      const resp = await radioInstance.getStationsByCountryCode({
        countryCode,
      });
      const popularStations = await getPopularStationsForCountry(countryCode);
      // filter out blacklisted stations
      const radioList = resp.data.filter(station => !stationsBlacklist[station.stationuuid]);
      popularStations.forEach(popularItem => {
        const radioItem = radioList.find(item => item.stationuuid === popularItem.stationuuid);
        radioItem.votes += popularItem.splitcloud_unique_plays * 1e3; // make the unique plays on splitcloud count 1k more than a vote
      });
      // add custom stations for countryCode
      if (constants.STATIONS_CUSTOM[countryCode]) {
        radioList.push(...constants.STATIONS_CUSTOM[countryCode]);
      }
      formattedRadioList = formatters.formatRadioStationListPayload(radioList);
      // cache the formatted radiostation list to cache bucket with 7day expiry rule
      await helpers.writeS3Cache(radioListCacheKey, formattedRadioList, 'ttl7');
    }
    callback(null, {
      statusCode: 200,
      body: JSON.stringify(formattedRadioList),
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
    return callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify(appConfig),
    });
  },
  { STREAM_CLIENT_ID: 'invalidtokeninvalidtoken00000000', disable_sc: true },
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
        ctaUrl: `http://www.splitcloud-app.com/?ref=upgrade&deviceId=${deviceId}`,
        ctaLabel: 'Update SplitCloud Now!',
        ctaButtonColor: '#FF7F50',
        ctaAction: { type: 'url' },
      }),
    });
    return true;
  }
  return false;
};

const ctaHandleWrappedYearlyPlaylist = async (event, context, callback) => {
  const currMonth = new Date().getUTCMonth() + 1; // since Date months are 0 indexed
  const currentYear = new Date().getUTCFullYear();
  const { deviceId, side } = event.pathParameters;
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const dateInRange = constants.WRAPPED_YEAR_MONTH.includes(currMonth);
  if (semverCompare(clientVersion, MIN_PLAYLIST_IN_CTA_VERSION) === -1) return false;
  if (!dateInRange && !helpers.isDEV) {
    console.log('disabled wrapped on this date in prod');
    return false;
  }
  const playlistPath = `charts/wrapped/${currentYear}/${deviceId}_${side}.json`;
  let wrappedPlaylist;
  try {
    wrappedPlaylist = await helpers.readJSONFromS3(playlistPath);
  } catch (err) {
    console.log('no wrapped playlist found', playlistPath);
    return false;
  }
  callback(null, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
    },
    body: JSON.stringify({
      ctaUrl: '',
      ctaLabel: 'Your 2020 Rewind!',
      ctaButtonColor: '#FF7F50',
      ctaAction: {
        type: 'wrapped_playlist',
        data: formatters.formatPlaylistPayload(
          formatters.createPlaylistFromTrackList(wrappedPlaylist, 'Your 2020 Rewind')
        ),
      },
    }),
  });
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
        ctaAction: { type: 'url' },
      }),
    });
    return true;
  }
  return false;
};


const ctaHandleGiveaway = (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  const promoExpiry = new Date('2020-08-31T23:59:00.000Z');
  if (isAndroidId && new Date() < promoExpiry) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify({
        ctaLabel: '✨Tap to WIN ✨',
        ctaUrl: `http://www.splitcloud-app.com/giveaway.html`,
        ctaButtonColor: '#9f0202',
        ctaAction: { type: 'url' },
      }),
    });
    return true;
  }
  return false;
};
/**
 *  /cta/{deviceId}/{side}
 */
module.exports.ctaEndpoint = metricScope(metrics =>
  blockUnsupportedVersions(async (event, context, callback) => {
    const { deviceId } = event.pathParameters;
    const ctaBgBlue = '#2196F3';
    const ctaLabelA = 'Follow SplitCloud ✨';
    const ctaLabelB = '⚡️ Follow @SplitCloud';
    const isAndroidId = deviceId.length === 16;

    const selectedVariant = helpers.selectVariantFromHash(deviceId) ? 'A' : 'B';
    const ctaButtonColor = ctaBgBlue;
    let ctaUrl = `http://www.splitcloud-app.com/follow.html`;
    if (isAndroidId) {
      ctaUrl = `http://www.splitcloud-app.com/follow_android_promo.html`;
    }
    ctaUrl = `${ctaUrl}?variant=${selectedVariant}&v=5`;
    const ctaLabel = selectedVariant === 'A' ? ctaLabelA : ctaLabelB;
    if (ctaHandleEndOfLife(event, context, callback)) return true;
    if (await ctaHandleWrappedYearlyPlaylist(event, context, callback)) return true;
    if (ctaHandleCountryPromotion(event, context, callback)) return true;
    if (ctaHandleGiveaway(event, context, callback)) return true;
    metrics.setNamespace('ctaEndpoint');
    metrics.putMetric(`test_variant_${selectedVariant}`, 1);
    return callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify({
        ctaLabel,
        ctaUrl,
        ctaButtonColor,
        ctaAction: { type: 'url' },
      }),
    });
  })
);
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
module.exports.exploreRelated = metricScope(metrics =>
  blockUnsupportedVersions(async (event, context, callback) => {
    // eslint-disable-next-line prefer-const
    let allInputTracks = JSON.parse(event.body) || [];
    metrics.setNamespace('splitcloud-exploreRelated');
    metrics.putMetric('inputFavTracks', allInputTracks.length);
    helpers.arrayInPlaceShuffle(allInputTracks); // shuffle input tracks
    const userInputTracks = allInputTracks.slice(
      0,
      constants.EXPLORE_RELATED.MAX_USER_SOURCE_TRACKS
    );
    let sourceTrackIds = [...userInputTracks];
    let clientCountry =
      helpers.getQueryParam(event, 'region') || event.headers['CloudFront-Viewer-Country'];

    const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
    if (!hasCountryPlaylist) clientCountry = 'GLOBAL';
    const playlistFilename = `charts/country/weekly_trending_country_${clientCountry}.json`;
    const playlistPayload = await helpers.readJSONFromS3(playlistFilename);
    const topTrackIds = playlistPayload
      .slice(0, constants.EXPLORE_RELATED.MAX_SOURCE_TRACKS)
      .map(t => t.id);
    console.log(`fetching trending chart for country ${clientCountry}`);
    const fillNbr = constants.EXPLORE_RELATED.MAX_SOURCE_TRACKS - sourceTrackIds.length;
    console.log(
      `use ${sourceTrackIds.length} sourceTracks and ${fillNbr} charts track to generate lists`
    );
    sourceTrackIds = [...sourceTrackIds, ...topTrackIds.slice(0, fillNbr)];
    console.log('final source tracks', sourceTrackIds);
    let relatedTrackList = await chartService.fetchAllRelated(sourceTrackIds);
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
      // exclude duplicate tracks
      if (uniqueSet.has(t.id)) return false;
      const hasTagMatch = getTrackTags(t).find(scTag => relatedTagsSet.has(scTag));
      // if tags are matching and track is unique, add it to results
      if (hasTagMatch) {
        console.log(`adding track: ${t.title} because matched tag:`, hasTagMatch);
      }
      return hasTagMatch;
    });
    relatedTrackList.push(...recentRelated); // add sc recents tracks relevant for feed
    // filter all tracks by input unicode scripts
    const resolvedInputTracks = await chartService.fetchScTrackList(userInputTracks);
    const userTrackTitles = resolvedInputTracks.map(item => item.title).join(' ');
    console.log('source tracks titles', userTrackTitles);
    const allowedLangScripts = helpers.getStringScripts(userTrackTitles);
    console.log('allowedLangScripts', allowedLangScripts);
    relatedTrackList = relatedTrackList.filter(track => {
      if (!allowedLangScripts.length) return true;
      const currTrackScript = helpers.getStringScripts(track.title);
      if (currTrackScript.length === 0 && helpers.isStringNumeric(track.title)) return true;
      const isAllowed = helpers.arrayIntersect(allowedLangScripts, currTrackScript).length > 0;
      if (!isAllowed) console.log('excluding track for unicode script:', track.title);
      return isAllowed;
    });
    // add in any promoted tracks payload from s3
    let promotedScTracks;
    try {
      promotedScTracks = await helpers.readJSONFromS3(`app/suggested_tracklist.json`);
    } catch (err) {
      promotedScTracks = [];
    }
    if (Array.isArray(promotedScTracks)) {
      relatedTrackList.push(...promotedScTracks);
    }
    // order all by recency
    relatedTrackList.sort(sortByDateDay);

    return callback(null, {
      statusCode: 200,
      headers: {
        ...corsHeaders,
      },
      body: JSON.stringify(formatters.formatTrackListPayload(relatedTrackList)),
    });
  })
);
