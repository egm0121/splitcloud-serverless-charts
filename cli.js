const { performance } = require('perf_hooks');
const chartService = require('./index');

(async () => {
  const timeStart = performance.now();
  await chartService.saveChartToFile();
  console.log('Time taken', performance.now() - timeStart);
})();
