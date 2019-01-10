const { performance } = require('perf_hooks');
const moment = require('moment');
const chartService = require('./index');

const logTracks = tracks => {
  tracks.map(t =>
    console.log(
      t.id,
      t.title,
      t.splitcloud_total_plays,
      t.splitcloud_unique_plays,
      t.score,
      t.daysDistance
    )
  );
  return tracks;
};
(async () => {
  const timeStart = performance.now();
  const currDate = moment().format('L');
  console.log('TRENDING on ', currDate);
  await chartService.getTrendingChart().then(logTracks);
  console.log('POPULAR on ', currDate);
  await chartService.getTopChart().then(logTracks);
  console.log('Time taken', performance.now() - timeStart);
})();
