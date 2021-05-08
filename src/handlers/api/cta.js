import wrappedPlaylistGenerator from '../../modules/wrappedPlaylistGenerator';

const semverCompare = require('semver-compare');
const helpers = require('../../modules/helpers');
const constants = require('../../constants/constants');
const formatters = require('../../modules/formatters');

const LATEST_VERSION = '6.0'; // stuck for ios to 6.0
const MIN_PLAYLIST_IN_CTA_VERSION = '6.0'; // first client version that supports embedding playlist in CTA response
const MIN_SHARE_SCREEN_IN_CTA_VERSION = '6.3'; // first client version that supports opening the share_app_screen

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
  let currentYear = new Date().getUTCFullYear();
  if (currMonth === 1) currentYear -= 1; // use prev year if running in january
  const { deviceId, side } = event.pathParameters;
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const dateInRange = constants.WRAPPED_YEAR_MONTH.includes(currMonth);
  if (semverCompare(clientVersion, MIN_PLAYLIST_IN_CTA_VERSION) === -1) return false;
  if (!dateInRange) return false;
  const playlistPath = `charts/wrapped/${currentYear}/${deviceId}_${side}.json`;
  let wrappedPlaylist;
  try {
    wrappedPlaylist = await helpers.readJSONFromS3(playlistPath);
  } catch (err) {
    console.log('no cached wrapped playlist found', playlistPath);
  }
  if (!wrappedPlaylist) {
    try {
      wrappedPlaylist = await helpers.timeoutAfter(
        wrappedPlaylistGenerator.getWrappedForDeviceIdSideYear(deviceId, side, currentYear),
        8 * 1e3 // 8 sec of time to generate (cta req has a timeout of 10s)
      );
      await helpers.saveFileToS3(playlistPath, wrappedPlaylist);
      context.metrics.putMetric('ctaWrappedGenerated', 1);
    } catch (err) {
      console.error('wrapped playlist failed:', err.message);
      return false;
    }
  }
  if (!wrappedPlaylist.length) return false;
  context.metrics.putMetric('ctaWrappedPlaylist', 1);
  return callback(null, {
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
  const promoExpiry = new Date(constants.CTA.GIVEAWAY_EXPIRY);
  if (isAndroidId && new Date() < promoExpiry) {
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify({
        ctaLabel: '✨ Tap to WIN ✨',
        ctaUrl: `http://www.splitcloud-app.com/giveaway.html`,
        ctaButtonColor: '#9f0202',
        ctaAction: { type: 'url' },
      }),
    });
    return true;
  }
  return false;
};

const ctaHandleReferralFeatureAndroid = async (event, context, callback) => {
  const { deviceId } = event.pathParameters;
  const isAndroidId = deviceId.length === 16;
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const promoExpiry = new Date(constants.CTA.REFERRAL_FEATURE_EXPIRY);
  if (semverCompare(clientVersion, MIN_SHARE_SCREEN_IN_CTA_VERSION) === -1) return false;
  if (isAndroidId && new Date() < promoExpiry) {
    let rewardedReferralMap = {};
    try {
      rewardedReferralMap = await helpers.readJSONFromS3(`referrers/rewarded/devicemap.json`);
    } catch (err) {
      console.error(`No devicemap found`);
    }
    const hasPromoCode = rewardedReferralMap[deviceId];
    const ctaLabel = hasPromoCode ? '✅ Remove Ads Unlocked!' : '👫 FREE Remove ADS 🎁';
    const ctaButtonColor = hasPromoCode ? '#2196F3' : '#FF7F50';
    callback(null, {
      statusCode: 200,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify({
        ctaLabel,
        ctaUrl: '',
        ctaButtonColor,
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
  if (ctaHandleCountryPromotion(event, context, callback)) return true;
  if (ctaHandleGiveaway(event, context, callback)) return true;
  if (await ctaHandleReferralFeatureAndroid(event, context, callback)) return true;
  context.metrics.putMetric(`test_variant_${selectedVariant}`, 1);
  return ctaHandleDefaultStrategy(event, context, callback);
};
