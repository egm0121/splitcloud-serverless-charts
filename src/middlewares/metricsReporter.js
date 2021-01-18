/* eslint-disable no-param-reassign */
const { metricScope } = require('aws-embedded-metrics');

const metricsReporterMiddleware = (opts = {}) => (event, context, callback, next) => {
  const decoratedHandler = metricScope(metrics => {
    context.metrics = metrics;
    return async () => next();
  });
  decoratedHandler(event, context, callback);
};

export default metricsReporterMiddleware;
