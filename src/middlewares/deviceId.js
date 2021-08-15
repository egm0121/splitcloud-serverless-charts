/* eslint-disable no-param-reassign */
const helpers = require('../modules/helpers');

const deviceIdMiddleware = () => (event, context, callback, next) => {
  const clientDeviceId = helpers.getQueryParam(event, 'deviceId') || '';
  context.deviceId = clientDeviceId;
  context.isDeviceAndroid = clientDeviceId.length === 16;
  context.isDeviceIOS = clientDeviceId.length !== 16;
  return next();
};

export default deviceIdMiddleware;
