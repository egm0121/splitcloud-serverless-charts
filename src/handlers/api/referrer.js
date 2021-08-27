import helpers from '../../modules/helpers';
import Referrals from '../../repositories/Referrals';

const MIN_REFERRER_REWARD = 3;

export const handleUpdateReferrer = async (event, context, callback) => {
  console.log('handleUpdateReferrer');
  context.metrics.setNamespace('splitcloud-appReferrer');
  const deviceId = helpers.getQueryParam(event, 'deviceId');
  const bodyPayload = JSON.parse(event.body) || {};
  const { referrerString } = bodyPayload;
  const parsedReferrerParams = new URLSearchParams(referrerString);
  console.log('parsed referrer info', parsedReferrerParams);
  const referrerId = parsedReferrerParams ? parsedReferrerParams.get('utm_term') : '';
  let referreeList;
  if (parsedReferrerParams.get('utm_source') !== 'inapp' || !referrerId) {
    callback(null, {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: 'referrer id not found' }),
    });
    return;
  }
  try {
    referreeList = await Referrals.getAllReferreesForDevice(referrerId);
  } catch (err) {
    referreeList = [];
  }
  if (referreeList.find(item => item.refereeId === deviceId)) {
    console.log('referree present, skip');
    callback(null, { statusCode: 200, body: JSON.stringify({ success: true }) });
    return;
  }
  context.metrics.putMetric('userReferrerInstall', 1);
  try {
    console.log(`add referree for ${referrerId}: ${deviceId}`);
    await Referrals.insertReferreeForDevice(referrerId, deviceId);
  } catch (err) {
    console.warn(`failed updating referral for ${referrerId}`, err);
  }
  const hasExistingPromocode = await Referrals.getPromocodeForDevice(referrerId);
  // only assign a promocode to a referralId if the min number of referees has been reached
  // and no promocode has been assigned yet.
  if (referreeList.length + 1 >= MIN_REFERRER_REWARD && !hasExistingPromocode) {
    console.log(`will reward referrer: ${referrerId}`);
    try {
      console.log(`add referree for ${referrerId}: ${deviceId}`);
      await Referrals.assignPromocodeToDevice(referrerId);
      const remainingPromoCodes = await Referrals.getUnassignedPromocodesCount();
      context.metrics.putMetric('promocodeListSize', remainingPromoCodes);
    } catch (err) {
      console.warn(`failed assigning promocode to ${referrerId}`, err);
    }
  }
  callback(null, { statusCode: 200, body: JSON.stringify({ success: true }) });
};
export const handleFetchPromocode = async (event, context, callback) => {
  console.log('handleFetchPromocode');
  context.metrics.setNamespace('splitcloud-appPromocodeRef');
  const deviceId = helpers.getQueryParam(event, 'deviceId');
  const devicePromocode = await Referrals.getPromocodeForDevice(deviceId);
  console.log('found promocode', devicePromocode);
  if (deviceId && devicePromocode) {
    context.metrics.putMetric('rewardedPromocodeServed', 1);
    console.log('referral promocode found for', deviceId);
    callback(null, {
      statusCode: 200,
      body: JSON.stringify({ success: true, code: devicePromocode }),
    });
    return;
  }
  callback(null, { statusCode: 200, body: JSON.stringify({ success: false }) });
};
