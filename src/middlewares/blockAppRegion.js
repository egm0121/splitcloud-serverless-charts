const blockRegionMiddleware = (opts = {}) => (event, context, callback, next) => {
  const errBody = opts.errBody || { error: 'unsupported client region' };
  const errCode = opts.errCode || 400;
  if (opts.countryCodeBlacklist.includes(context.requestCountryCode)) {
    console.warn({
      middleware: 'blockRegion',
      logEvent: 'unsupportedRegion',
      statusCode: errCode,
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
export default blockRegionMiddleware;
