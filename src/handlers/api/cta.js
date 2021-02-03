const semverCompare = require('semver-compare');
const chartService = require('../../modules/chartsService');
const helpers = require('../../modules/helpers');
const constants = require('../../constants/constants');
const formatters = require('../../modules/formatters');

const LATEST_VERSION = '6.0'; // stuck for ios to 6.0
const MIN_PLAYLIST_IN_CTA_VERSION = '6.0'; // first client version that supports embedding playlist in CTA response
const MIN_SHARE_SCREEN_IN_CTA_VERSION = '6.3'; // first client version that supports opening the share_app_screen

let wrappedDeviceList;

const ctaHandleEndOfLife = (event, context, callback) => {
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const { deviceId } = event.pathParameters;
  if (!clientVersion || semverCompare(clientVersion, LATEST_VERSION) === -1) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
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
  if (!wrappedDeviceList) {
    console.log('read wrapped device list from storage');
    try {
      wrappedDeviceList = await helpers.readJSONFromS3(
        `charts/wrapped/${currentYear}/wrappedDeviceList.json`
      );
    } catch (err) {
      wrappedDeviceList = [];
      console.log('no wrapped device list found');
    }
  }
  if (wrappedDeviceList.indexOf(deviceId) === -1) {
    console.log('deviceId not found');
    return false;
  }
  const playlistPath = `charts/wrapped/${currentYear}/${deviceId}_${side}.json`;
  let wrappedPlaylist;
  try {
    wrappedPlaylist = await helpers.readJSONFromS3(playlistPath);
  } catch (err) {
    console.log('no wrapped playlist found', playlistPath);
  }
  if (!wrappedPlaylist) {
    try {
      wrappedPlaylist = await helpers.timeoutAfter(
        chartService.getYearlyPopularTrackByDeviceId(10, deviceId, side),
        8 * 1e3 // 8 sec of time to generate
      );
      await saveToS3(playlistPath, wrappedPlaylist);
      context.metrics.putMetric('ctaWrappedGenerated', 1);
    } catch (err) {
      console.error('wrapped playlist failed:', err.message);
      return false;
    }
  }
  if (!wrappedPlaylist.length) {
    return false;
  }
  context.metrics.putMetric('ctaWrappedPlaylist', 1);
  callback(null, {
    statusCode: 200,
    headers: {
      ...context.headers,
    },
    body: JSON.stringify({
      ctaUrl: '',
      ctaLabel: `Your ${currentYear} Top Songs!`,
      ctaButtonColor: '#FF7F50',
      ctaAction: {
        type: 'wrapped_playlist',
        data: formatters.formatPlaylistPayload(
          formatters.createPlaylistFromTrackList(wrappedPlaylist, `Your ${currentYear} Top 10`)
        ),
      },
    }),
  });
};
const ctaHandleCountryWrappedPlaylist = async (event, context, callback) => {
  const currMonth = new Date().getUTCMonth() + 1; // since Date months are 0 indexed
  let currentYear = new Date().getUTCFullYear();
  if (currMonth !== 12) currentYear -= 1;
  const clientCountry = (
    helpers.getQueryParam(event, 'region') ||
    event.headers['CloudFront-Viewer-Country'] ||
    'US'
  ).toUpperCase();
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const dateInRange = constants.WRAPPED_COUNTRY_YEAR_MONTH.includes(currMonth);
  const isRegionEnabled = clientCountry in constants.YEAR_WRAPPED_COUNTRIES;
  if (clientCountry === 'US') return false; // exclude US from year wrapped playlist
  if (semverCompare(clientVersion, MIN_PLAYLIST_IN_CTA_VERSION) === -1) return false;
  if (context.selectedVariant === 'B') return false;
  if (!isRegionEnabled) return false;
  if (!dateInRange && !helpers.isDEV) {
    console.log('disabled country wrapped on this date in prod');
    return false;
  }
  const playlistPath = `charts/wrapped_country/${currentYear}/wrapped_${clientCountry}.json`;
  let wrappedPlaylist;
  try {
    wrappedPlaylist = await helpers.readJSONFromS3(playlistPath);
  } catch (err) {
    console.log('no country wrapped playlist found', playlistPath);
    return false;
  }
  if (!wrappedPlaylist.length) return false;
  callback(null, {
    statusCode: 200,
    headers: {
      ...context.headers,
    },
    body: JSON.stringify({
      ctaUrl: '',
      ctaLabel: `Top ${currentYear} ${clientCountry} Songs!`,
      ctaButtonColor: '#FF7F50',
      ctaAction: {
        type: 'playlist',
        data: formatters.formatPlaylistPayload(
          formatters.createPlaylistFromTrackList(
            wrappedPlaylist,
            `Top ${currentYear} ${clientCountry} Songs!`
          )
        ),
      },
    }),
  });
};
const ctaHandleCountryPromotion = (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  const clientCountry = (
    helpers.getQueryParam(event, 'region') ||
    event.headers['CloudFront-Viewer-Country'] ||
    'US'
  ).toUpperCase();
  if (isAndroidId && clientCountry in constants.COUNTRY_PROMOTION) {
    const promo = constants.COUNTRY_PROMOTION[clientCountry];
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
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
  const promoExpiry = new Date(constants.CTA.REFERRAL_FEATURE_EXPIRY);
  if (isAndroidId && new Date() < promoExpiry) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
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

const ctaHandleReferralFeatureAndroid = (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const promoExpiry = new Date(constants.CTA.REFERRAL_FEATURE_EXPIRY);
  if (semverCompare(clientVersion, MIN_SHARE_SCREEN_IN_CTA_VERSION) === -1) return false;
  if (isAndroidId && new Date() < promoExpiry) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify({
        ctaLabel: '👫 FREE Remove ADS 🎁',
        ctaUrl: '',
        ctaButtonColor: '#FF7F50',
        ctaAction: { type: 'share_app_screen' },
      }),
    });
    return true;
  }
  return false;
};
const ctaHandleDefaultStrategy = (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const { selectedVariant } = context;
  const isAndroidId = deviceId.length === 16;
  const ctaBgBlue = '#2196F3';
  const ctaLabelA = 'Follow SplitCloud ✨';
  const ctaLabelB = 'Follow SplitCloud ✨';
  const ctaButtonColor = ctaBgBlue;
  let ctaUrl = `http://www.splitcloud-app.com/follow.html`;
  if (isAndroidId) {
    ctaUrl = `http://www.splitcloud-app.com/follow_android_promo.html`;
  }
  ctaUrl = `${ctaUrl}?variant=${selectedVariant}&v=5`;
  const ctaLabel = selectedVariant === 'A' ? ctaLabelA : ctaLabelB;
  callback(null, {
    statusCode: 200,
    headers: {
      ...context.headers,
    },
    body: JSON.stringify({
      ctaLabel,
      ctaUrl,
      ctaButtonColor,
      ctaAction: { type: 'url' },
    }),
  });
  return true;
};
export default async (event, context, callback) => {
  console.log('cta endpoint handler');
  // this is needed to make sure that we return to the client as soon as callback is invoked,
  // event if some promise is still pending after a timeout
  // eslint-disable-next-line no-param-reassign
  context.callbackWaitsForEmptyEventLoop = false;
  const { deviceId } = event.pathParameters;
  context.metrics.setNamespace('ctaEndpoint');
  const selectedVariant = helpers.selectVariantFromHash(deviceId) ? 'A' : 'B';
  // eslint-disable-next-line no-param-reassign
  context.selectedVariant = selectedVariant;
  if (ctaHandleEndOfLife(event, context, callback)) return true;
  if (await ctaHandleWrappedYearlyPlaylist(event, context, callback)) return true;
  if (await ctaHandleCountryWrappedPlaylist(event, context, callback)) return true;
  if (ctaHandleCountryPromotion(event, context, callback)) return true;
  if (ctaHandleGiveaway(event, context, callback)) return true;
  if (ctaHandleReferralFeatureAndroid(event, context, callback)) return true;
  context.metrics.putMetric(`test_variant_${selectedVariant}`, 1);
  return ctaHandleDefaultStrategy(event, context, callback);
};