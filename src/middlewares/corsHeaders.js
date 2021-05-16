/* eslint-disable no-param-reassign */
const corsHeadersMiddleware = (
  opts = {
    corsHeaders: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
  }
) => (event, context, callback, next) => {
  const prevHeaders = context.headers || {};
  context.headers = { ...prevHeaders, ...opts.corsHeaders };
  return next();
};

export default corsHeadersMiddleware;
