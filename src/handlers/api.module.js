/* eslint-disable no-param-reassign */
import axios from 'axios';
import RadioApi from '../modules/radioApi';
import ctaHandler from './api/cta';
import feedGeneratorMiddleware, { testScoreWithDecaySorting } from './api/exploreRelated';
import corsHeadersMiddleware from '../middlewares/corsHeaders';
import blockVersionsMiddleware from '../middlewares/blockAppVersion';
import metricsReporterMiddleware from '../middlewares/metricsReporter';
import requestCountryCodeMiddleware from '../middlewares/requestCountryCode';
import deviceIdMiddleware from '../middlewares/deviceId';
import wrappedPlaylistGenerator from '../modules/wrappedPlaylistGenerator';
import { handleUpdateReferrer, handleFetchPromocode } from './api/referrer';
import blockRegionMiddleware from '../middlewares/blockAppRegion';

const helpers = require('../modules/helpers');
const constants = require('../constants/constants');
const formatters = require('../modules/formatters');
const exceptionIosDevices = require('../../key/exception_devices.json');

const SC_RESOLVE_ENDPOINT = 'https://api.soundcloud.com/resolve';
const { APP_BUCKET, KINESIS_STREAM_NAME, RAPSUM_BUCKET } = process.env;

/**
 *
 * REST API methods
 *
 * * */
/**
 * rapsum/trends - experimental endpoint
 */
const cachedRapsumData = {};
const cachedRapsumTopList = [];
let cachedRapsumHeaders = [];

module.exports.rapsumTrends = helpers.middleware([
  corsHeadersMiddleware(),
  async (event, context, callback) => {
    const term = helpers.getQueryParam(event, 'term');
    const exactMatch = helpers.getQueryParam(event, 'exact') || false;
    const popChart = helpers.getQueryParam(event, 'chart') || '' === 'popular';
    if (!Object.keys(cachedRapsumData).length) {
      const csvData = await helpers.readFileFromS3({
        bucket: RAPSUM_BUCKET,
        keyName: 'data/term_trends.csv',
        resolveExactPath: true,
      });
      csvData.split('\n').forEach((dataRecord, idx) => {
        const fields = dataRecord.split(',');
        // first extract labels from header
        if (!idx) {
          cachedRapsumHeaders = fields.slice(1).map(yearMonth => +new Date(`${yearMonth}-01`));
          return;
        }
        const termClean = (fields[0] || '').trim();
        cachedRapsumData[termClean] = fields.slice(1).map(d => parseInt(d, 10));
        if (idx <= 50) {
          cachedRapsumTopList.push([termClean, ...cachedRapsumData[termClean]]);
        }
      });
    }
    if (popChart) {
      callback(null, {
        statusCode: 200,
        headers: {
          ...context.headers,
        },
        body: JSON.stringify({ cachedRapsumTopList }),
      });
      return;
    }
    if (cachedRapsumData[term]) {
      let finalData = cachedRapsumData[term];
      if (!exactMatch) {
        const pluralMatch = cachedRapsumData[`${term}s`];
        if (pluralMatch) {
          finalData = finalData.map((termCount, termIdx) => termCount + pluralMatch[termIdx]);
        }
      }
      callback(null, {
        statusCode: 200,
        headers: {
          ...context.headers,
        },
        body: JSON.stringify({ headers: cachedRapsumHeaders, data: finalData }),
      });
    } else {
      callback(null, {
        statusCode: 200,
        headers: {
          ...context.headers,
        },
        body: JSON.stringify({ headers: cachedRapsumHeaders, data: [] }),
      });
    }
  },
]);
/**
 * /regions
 */
module.exports.chartsEndpoint = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  async (event, context, callback) => {
    let clientCountry = (
      helpers.getQueryParam(event, 'region') ||
      event.headers['CloudFront-Viewer-Country'] ||
      'US'
    ).toUpperCase();
    const playlistKind = event.queryStringParameters.kind;
    if (!['popular', 'trending'].includes(playlistKind)) {
      console.warn({
        endpoint: 'chartsEndpoint',
        logEvent: 'badRequest',
        statusCode: 400,
        playlistKind,
      });
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
        ...context.headers,
      },
      body: JSON.stringify(formatters.formatTrackListPayload(playlistPayload)),
    };
    callback(null, resp);
  },
]);
/**
 * GET
 * /searchterms/popular
 */
module.exports.searchTermsPopular = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  requestCountryCodeMiddleware(),
  async (event, context, callback) => {
    let clientCountry = context.requestCountryCode;
    const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
    if (!hasCountryPlaylist) {
      clientCountry = 'GLOBAL';
    }
    const topTermsObjectPath = `charts/searchterms/country/weekly_popular_country_${clientCountry}.json`;
    let searchTermsList = [];
    try {
      const rawTermsList = await helpers.readJSONFromS3({
        bucket: APP_BUCKET,
        keyName: topTermsObjectPath,
      });
      searchTermsList = rawTermsList.map(term => term.id);
    } catch (err) {
      searchTermsList = [];
    }
    const resp = {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify(searchTermsList),
    };
    callback(null, resp);
  },
]);
/**
 * GET
 * /charts/nowplaying
 */
module.exports.nowPlaying = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  requestCountryCodeMiddleware(),
  async (event, context, callback) => {
    let clientCountry = context.requestCountryCode;
    const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
    if (!hasCountryPlaylist) {
      clientCountry = 'GLOBAL';
    }
    const realtimeGlobalObjectPath = `events/aggregated/nowplaying/global.json`;
    let trackList = [];
    try {
      trackList = await helpers.readJSONFromS3({
        bucket: APP_BUCKET,
        keyName: realtimeGlobalObjectPath,
      });
    } catch (err) {
      trackList = [];
    }
    const resp = {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: constants.DISABLE_SC ? JSON.stringify([]) : JSON.stringify(trackList),
    };
    callback(null, resp);
  },
]);
/**
 * /top/regions
 */

module.exports.topRegions = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  (event, context, callback) => {
    callback(null, {
      statusCode: 200,
      headers: { ...context.headers },
      body: JSON.stringify(constants.TOP_COUNTRIES),
    });
  },
]);
/**
 * /posts/regions
 */
module.exports.postsRegions = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  (event, context, callback) => {
    callback(null, {
      statusCode: 200,
      headers: { ...context.headers },
      body: JSON.stringify(constants.IG_POST_COUNTRIES),
    });
  },
]);

/**
 * /radio/countrycodes
 */
module.exports.radioCountryCodes = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  (event, context, callback) => {
    const radioCountryList = constants.RADIO_COUNTRY_CODES;
    const clientCountry = (
      helpers.getQueryParam(event, 'region') ||
      event.headers['CloudFront-Viewer-Country'] ||
      'US'
    ).toUpperCase();
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
  },
]);

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
module.exports.radioListByCountryCode = helpers.middleware([
  corsHeadersMiddleware(),
  async (event, context, callback) => {
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
          if (radioItem) {
            radioItem.votes += popularItem.splitcloud_unique_plays * 1e3; // make the unique plays on splitcloud count 1k more than a vote
          }
        });
        // add custom stations for countryCode
        if (constants.STATIONS_CUSTOM[countryCode]) {
          console.log('pushed custom stations', countryCode);
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
  },
]);
/**
 * /app/feedback/{deviceid}
 */
module.exports.logCollector = helpers.middleware([
  corsHeadersMiddleware(),
  async (event, context, callback) => {
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
    await helpers.saveFileToS3(
      {
        bucket: APP_BUCKET,
        keyName: `feedback_logs/${date}/${deviceid}-${timeNoMillis}.log`,
      },
      logStr,
      false
    );
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify({ success: true }),
    });
  },
]);
/**
 * /app/events/ingest
 */
module.exports.eventIngest = helpers.middleware([
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  requestCountryCodeMiddleware(),
  async (event, context, callback) => {
    const batchEventsPayload = JSON.parse(event.body);
    let returnData = [];
    if (batchEventsPayload && Array.isArray(batchEventsPayload)) {
      returnData = await Promise.all(
        batchEventsPayload.map(eventPayload => {
          const serializedPayload = `${JSON.stringify({
            ...eventPayload,
            serverTS: Date.now(),
            country: context.requestCountryCode,
          })}\n`;
          return helpers.kinesisFirehose
            .putRecord({
              DeliveryStreamName: KINESIS_STREAM_NAME,
              Record: {
                Data: serializedPayload,
              },
            })
            .promise();
        })
      );
    }
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify({ success: true, data: returnData }),
    });
  },
]);
/**
 * Returns wrapped playlist for year -deviceId- side from cache or athena
 * /wrapped/{year}/{deviceId}/{side}
 */
module.exports.yearWrappedTopList = helpers.middleware([
  corsHeadersMiddleware(),
  async (event, context, callback) => {
    const responseWithTrackList = trackList =>
      callback(null, {
        statusCode: 200,
        headers: {
          ...context.headers,
        },
        body: JSON.stringify(trackList),
      });
    const { year, deviceId, side } = event.pathParameters;
    const sideUpper = (side || '').toUpperCase()[0];
    const jsonCacheFileName = `charts/wrapped/${year}/${deviceId}_${sideUpper}.json`;
    let trackList;
    try {
      trackList = await helpers.readJSONFromS3(jsonCacheFileName);
    } catch (err) {
      console.log('no cache found for', jsonCacheFileName, 'generating...');
    }
    if (trackList) {
      responseWithTrackList(trackList);
      return;
    }
    try {
      trackList = await wrappedPlaylistGenerator.getWrappedForDeviceIdSideYear(
        deviceId,
        sideUpper,
        year
      );
      responseWithTrackList(trackList);
      return;
    } catch (err) {
      console.error({ err, year, deviceId, side }, 'wrapped playlist fetch failed');
      responseWithTrackList([]);
    }
  },
]);
/**
 * Returns top of the current year playlist
 * /wrapped/global/:kind
 */
module.exports.globalYearWrapped = helpers.middleware([
  blockVersionsMiddleware(),
  async (event, context, callback) => {
    const { kind = 'popular' } = event.pathParameters;
    const allWeeksProms = Array(52)
      .fill(1)
      .map((v, k) => k + 1)
      .map(weekNo =>
        helpers.readJSONFromS3(`charts/weekly_${kind}_${weekNo}.json`).catch(() => [])
      );
    let allWeeksCharts;
    try {
      allWeeksCharts = await Promise.all(allWeeksProms);
    } catch (err) {
      console.log('error fetching weekly charts');
    }
    const trackMap = allWeeksCharts.reduce((acc, currWeek) => {
      currWeek.forEach(track => {
        if (track.id in acc) {
          acc[track.id].splitcloud_total_plays += track.splitcloud_total_plays;
        } else {
          acc[track.id] = track;
        }
      });
      return acc;
    }, {});
    const trackList = Object.values(trackMap)
      .sort((a, b) => b.splitcloud_total_plays - a.splitcloud_total_plays)
      .slice(0, 15);
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify(trackList),
    });
  },
]);
/**
 *  /app/config
 */
module.exports.appConfigApi = helpers.middleware([
  corsHeadersMiddleware(),
  requestCountryCodeMiddleware(),
  deviceIdMiddleware(),
  blockVersionsMiddleware({
    errBody: null,
    errHeaders: {
      Location: 'http://www.splitcloud-app.com/app/app_config_9.json',
    },
    errCode: 302,
  }),
  blockRegionMiddleware({
    countryCodeBlacklist: constants.COUNTY_CODES_BLACKLIST,
    errBody: { STREAM_CLIENT_ID: 'unsupportedcountrytoken', disable_sc: true, disable_radio: true },
    errCode: 200,
  }),
  async (event, context, callback) => {
    const jsonCacheFileName = `app/app_config_v2.json`;
    let appConfig;
    try {
      appConfig = await helpers.readJSONFromS3(jsonCacheFileName);
      // manage streaming availability
      appConfig.disable_sc = constants.DISABLE_SC;
      if (
        (constants.DISABLE_SC || (constants.DISABLE_SC_IOS && context.isDeviceIOS)) &&
        !exceptionIosDevices.includes(context.deviceId)
      ) {
        appConfig.disable_sc = true;
        appConfig.STREAM_CLIENT_ID = 'invalidtokeninvalidtoken00000000';
        appConfig.STREAM_ACCESS_TOKEN = '0-000000--00000000000000000000000';
      }
    } catch (err) {
      console.warn('failed fetching client config');
    }
    return callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify(appConfig),
    });
  },
]);
/**
 * proxy to follow 302 redirects while passing Authorization headers
 * for ios react-native fetch limitation.
 *  /sc-proxy/resolve
 */
module.exports.scResolve = async (event, context, callback) => {
  const scResourcePerma = helpers.getQueryParam(event, 'url');
  const clientAuthToken = event.headers.Authorization;
  const scAPIUrl = `${SC_RESOLVE_ENDPOINT}?url=${scResourcePerma}`;
  try {
    const scResp = await axios({
      method: 'get',
      url: scAPIUrl,
      headers: {
        Authorization: clientAuthToken,
      },
    });
    return callback(null, {
      statusCode: 200,
      body: JSON.stringify(scResp.data),
    });
  } catch (err) {
    console.warn({
      lambdaName: 'scResolve',
      logEvent: 'failed to resolve',
      scAPIUrl,
      error: err.toString(),
    });
    return callback(null, {
      statusCode: 400,
      body: JSON.stringify(err.response && err.response.data),
    });
  }
};
/**
 *  /cta/{deviceId}/{side}
 */
module.exports.ctaEndpoint = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware({
    errBody: {
      ctaUrl: 'http://www.splitcloud-app.com/getapp/index.html?ref=unsupportedVersion',
      ctaLabel: 'New SplitCloud update ⚡️',
      ctaButtonColor: '#FF7F50',
      ctaAction: { type: 'url' },
    },
    errCode: 200,
  }),
  ctaHandler,
]);

/**
 * POST
 * /app/referrer
 * Updates referral with this referee deviceId if valid referral is found for installation
 */
module.exports.appReferrer = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware({
    errBody: null,
    errHeaders: {
      Location: 'http://www.splitcloud-app.com/app/app_config_9.json',
    },
    errCode: 302,
  }),
  handleUpdateReferrer,
]);

/**
 * POST
 * /app/promocode/referrer
 * Check and return a reward promo-code if present for the current deviceId
 */
module.exports.appPromocodeRef = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  handleFetchPromocode,
]);

/**
 * Home feed generation handler
 * uses input fav track or country charts to grab related tracks
 * adds relevant SoundCloud trending songs or all SC trending songs if no fav input tracks available
 * adds any system defined suggested tracks if matching genre or no genre preference available
 * sorts all results by popularity + an exponential decay function to penalize older tracks
 * artificially gives system sponsored tracks the higest base_score so that only track age impacts its ranking
 * [POST] /explore/related
 */

module.exports.exploreRelated = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  requestCountryCodeMiddleware(),
  feedGeneratorMiddleware(),
  testScoreWithDecaySorting(),
  (event, context, callback) => {
    console.log(`got ${context.relatedTrackList.length} tracks from FeedGenerator`);
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify(formatters.formatTrackListPayload(context.relatedTrackList)),
    });
  },
]);
