const { performance } = require('perf_hooks');
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
  console.log('TRENDING');
  await chartService.getTrendingChart().then(logTracks);
  console.log('POPULAR');
  await chartService.getTopChart().then(logTracks);
  console.log('Time taken', performance.now() - timeStart);
})();
