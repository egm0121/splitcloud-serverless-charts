/* eslint-disable no-param-reassign */
import RadioApi from '../modules/radioApi';
import ctaHandler from './api/cta';
import exploreFeedHandler from './api/exploreRelated';
import corsHeadersMiddleware from '../middlewares/corsHeaders';
import blockVersionsMiddleware from '../middlewares/blockAppVersion';
import metricsReporterMiddleware from '../middlewares/metricsReporter';

const helpers = require('../modules/helpers');
const constants = require('../constants/constants');
const formatters = require('../modules/formatters');

const saveToS3 = helpers.saveFileToS3;

const MIN_REFERRER_REWARD = 3;

/**
 *
 * REST API methods
 *
 * * */
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
    await saveToS3(`feedback_logs/${date}/${deviceid}-${timeNoMillis}.log`, logStr, false);
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
 * Returns wrapped playlist for year -deviceId- side only if generated
 * /wrapped/{year}/{deviceId}/{side}
 */
module.exports.yearWrappedTopList = helpers.middleware([
  corsHeadersMiddleware(),
  async (event, context, callback) => {
    const { year, deviceId, side } = event.pathParameters;
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
          ...context.headers,
        },
        body: JSON.stringify(trackList),
      });
    }
    callback(null, {
      statusCode: 204,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify([]),
    });
  },
]);
/**
 * Returns top of the current year playlist
 * /wrapped/gloabl/:kind
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
  blockVersionsMiddleware({
    errBody: { STREAM_CLIENT_ID: 'invalidtokeninvalidtoken00000000', disable_sc: true },
    errCode: 200,
  }),
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
        ...context.headers,
      },
      body: JSON.stringify(appConfig),
    });
  },
]);

/**
 *  /cta/{deviceId}/{side}
 */
module.exports.ctaEndpoint = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  ctaHandler,
]);
/**
 * POST
 * /app/referrer
 * Updates referral with this deviceId if valid referral is found for installation
 */
module.exports.appReferrer = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  async (event, context, callback) => {
    const deviceId = helpers.getQueryParam(event, 'deviceId');
    const bodyPayload = JSON.parse(event.body) || {};
    const { referrerString } = bodyPayload;
    const parsedReferrerParams = new URLSearchParams(referrerString);
    console.log('parsed referrer info', parsedReferrerParams);
    const referrerId = parsedReferrerParams ? parsedReferrerParams.get('utm_term') : '';
    let referrerList;
    if (parsedReferrerParams.get('utm_source') !== 'inapp' || !referrerId) {
      callback(null, {
        statusCode: 200,
        body: JSON.stringify({ success: false, error: 'referrer id not found' }),
      });
      return;
    }
    context.metrics.setNamespace('splitcloud-appReferrer');
    context.metrics.putMetric('userReferrerInstall', 1);
    try {
      referrerList = await helpers.readJSONFromS3(`referrers/device/${referrerId}.json`);
    } catch (err) {
      referrerList = [];
    }
    if (referrerList.includes(deviceId)) {
      console.log('referral present, skip');
      callback(null, { statusCode: 200, body: JSON.stringify({ success: true }) });
      return;
    }
    referrerList.push(deviceId);
    try {
      console.log(`updated referrers for ${referrerId}: ${referrerList.join(',')}`);
      await helpers.saveFileToS3(`referrers/device/${referrerId}.json`, referrerList);
    } catch (err) {
      console.warn(`failed updating referral for ${referrerId}`, err);
    }
    if (referrerList.length >= MIN_REFERRER_REWARD) {
      console.log('will rewared referrer, send message to sqs REFERRER_PROMO_QUEUE');
      helpers.sqs
        .sendMessage({
          DelaySeconds: 5,
          MessageAttributes: {
            referrerId: {
              DataType: 'String',
              StringValue: referrerId,
            },
          },
          MessageBody: `assign promocode to referrer id: ${referrerId}`,
          QueueUrl: process.env.REFERRER_PROMO_QUEUE,
        })
        .promise();
    }
    callback(null, { statusCode: 200, body: JSON.stringify({ success: true }) });
  },
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
  async (event, context, callback) => {
    const deviceId = helpers.getQueryParam(event, 'deviceId');
    let rewardedReferralMap = {};
    try {
      rewardedReferralMap = await helpers.readJSONFromS3(`referrers/rewarded/devicemap.json`);
    } catch (err) {
      rewardedReferralMap = [];
    }
    if (rewardedReferralMap[deviceId]) {
      const promocode = rewardedReferralMap[deviceId];
      context.metrics.setNamespace('splitcloud-appPromocodeRef');
      context.metrics.putMetric('deviceRewardedPromocode', 1);
      console.log('referral promocode found for', deviceId);
      callback(null, { statusCode: 200, body: JSON.stringify({ success: true, code: promocode }) });
      return;
    }
    callback(null, { statusCode: 200, body: JSON.stringify({ success: false }) });
  },
]);

/**
 * Home feed generation handler
 * uses input fav track or country charts to grab related tracks
 * relevant add SoundCloud trending songs
 * adds any system defined suggested tracks if matching genre or no genre preference available
 * [POST] /explore/related
 */

module.exports.exploreRelated = helpers.middleware([
  metricsReporterMiddleware(),
  corsHeadersMiddleware(),
  blockVersionsMiddleware(),
  exploreFeedHandler,
]);
