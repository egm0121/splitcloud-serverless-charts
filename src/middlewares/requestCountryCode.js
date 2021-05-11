/* eslint-disable no-param-reassign */
const helpers = require('../modules/helpers');

const requestCountryCodeMiddleware = () => (event, context, callback, next) => {
  const clientCountry = (
    helpers.getQueryParam(event, 'region') ||
    event.headers['CloudFront-Viewer-Country'] ||
    'US'
  ).toUpperCase();
  context.requestCountryCode = clientCountry;
  return next();
};

export default requestCountryCodeMiddleware;
