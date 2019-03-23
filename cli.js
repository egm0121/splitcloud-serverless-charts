const { performance } = require('perf_hooks');
const moment = require('moment');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoverApi = require('./discoverApi');

const logTracks = tracks => {
  console.log(
    't.id',
    't.title',
    't.splitcloud_total_plays',
    't.splitcloud_unique_plays',
    't.score'
  );
  tracks
    .map(t =>
      console.log(
        JSON.stringify({
          id: t.id,
          score: t.score,
          splitcloud_unique_plays: t.splitcloud_unique_plays,
          title: t.title,
          genre: t.genre,
          username: t.username,
          duration: moment(t.duration).format('mm:ss')
        })
      )
    );
  return tracks;
};
(async () => {
  // const timeStart = performance.now();
  const currDate = moment().format('L');
  // console.log('TRENDING on ', currDate);
  // await chartService.getTrendingChart().then(logTracks);
  const country = undefined;
  console.log('POPULAR on ', currDate, ' country ', country);
  await chartService.getTopChart(undefined, country, '7daysAgo').then(logTracks);
  // console.log('Time taken', performance.now() - timeStart);
  // await selectActiveStreamToken();
  // const playlists = require('./discover_playlists_payload_dev.json');
  // await discoverApi(playlists);
})();
