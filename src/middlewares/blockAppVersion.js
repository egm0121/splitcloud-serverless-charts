const semverCompare = require('semver-compare');
const helpers = require('../modules/helpers');

const MIN_SUPPORTED_VERSION = '5.6'; // specify M.m without patch to allow matching client versions without patch
const VERSION_BLOCKLIST = ['8.2.192'];
const isUnsupportedVersion = clientVersion =>
  !clientVersion || semverCompare(clientVersion, MIN_SUPPORTED_VERSION) === -1;

const blockVersionsMiddleware = (opts = {}) => (event, context, callback, next) => {
  const clientVersion = helpers.getQueryParam(event, 'appVersion');
  const errBody = opts.errBody || { error: 'unsupported client version' };
  const errCode = opts.errCode || 400;
  if (isUnsupportedVersion(clientVersion) || VERSION_BLOCKLIST.includes(clientVersion)) {
    console.warn({
      middleware: 'blockVersions',
      logEvent: 'unsupportedClient',
      statusCode: errCode,
      clientVersion,
    });
    return callback(null, {
      statusCode: errCode,
      headers: {
        ...context.headers,
      },
      body: JSON.stringify(errBody),
    });
  }
  return next();
};
export default blockVersionsMiddleware;
