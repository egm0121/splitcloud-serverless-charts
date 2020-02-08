const { performance } = require('perf_hooks');
const moment = require('moment');
const chartService = require('./index');
const selectActiveStreamToken = require('./activeStreamToken');
const discoverApi = require('./discoverApi');
const reportStats = require('./reportStats');
const getScreenshots = require('./key/getScreenshots');
const fs = require('fs');
const axios = require('axios');
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
          splitcloud_total_plays: t.splitcloud_total_plays,
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
  const timeStart = performance.now();
  const currDate = moment().format('L');
  console.log('TRENDING on ', currDate);
  // await chartService.getTrendingChart().then(logTracks);
  // const country = undefined;
  // console.log('POPULAR on ', currDate, ' country ', country);
  await chartService.getTrendingChart(100,'US').then(logTracks);
  console.log('Time taken', performance.now() - timeStart);
  // await selectActiveStreamToken();
  // const playlists = require('./discover_playlists_payload_dev.json');
  // await discoverApi(playlists);
  // console.log('Average songs playback per day NEW USERS');
  // console.log(await reportStats.getAvgEventCount('30daysAgo',undefined,'NEW_USERS'));
  // console.log('Average songs playback per day RETURNING USERS');
  // console.log(await reportStats.getAvgEventCount('30daysAgo',undefined,'RETURN_USERS'));
  // console.log('Average positive Actions per day RETURNING USERS');
  // console.log(await reportStats.getAvgEventCount('30daysAgo',undefined,'RETURN_USERS','POSITIVE-ACTION'));
  // console.log('Average songs playback per user per month ALL_USERS');
  // console.log(await reportStats.getAvgEventCount('2019-01-01','0daysAgo','ALL_USERS','PLAYBACK-COMPLETED','ga:yearMonth'));
  // console.log('Average positive Actions per day NEW USERS');
  // const positiveInt = await reportStats.getAvgEventCount('30daysAgo',undefined,'NEW_USERS','POSITIVE-ACTION');
  // console.log(positiveInt.map((obj) => (obj.hitMax = obj.average / 30) && obj ));
  // console.log('Average positive Actions per day RETURN USERS');
  // const positiveIntRetUsers = await reportStats.getAvgEventCount('30daysAgo',undefined,'RETURN_USERS','POSITIVE-ACTION');
  // console.log(positiveIntRetUsers.map((obj) => (obj.hitMax = obj.average / 30) && obj ));
  // console.log('Average AD-STARTED per day NEW USERS');
  // console.log(await reportStats.getAvgEventCount('30daysAgo',undefined,'NEW_USERS','AD-STARTED'));
  // console.log('Average SOCIAL-SHARE per day NEW USERS');
  // console.log(await reportStats.getAvgEventCount('30daysAgo',undefined,'NEW_USERS','SHARE-COMPLETED'));
  // const deviceId = 'FB12F7C8-1D13-421C-9027-0F068262D6D9';
  // const deviceId = 'F9BB27D4-6C26-44E4-8665-47E70B7D555F';
  // const topTracks = await chartService.getPopularTracksByDeviceId(20, '2019-01-01', deviceId, 'R');
  // logTracks(topTracks);
  //   const grabScreenshot = async (year = '2019', deviceId, side) => {
  //     const targetUrl = `http://www.splitcloud-app.com/wrapped.html?id=${deviceId}&year=${year}&side=${side}&t=3`;
  //     let apiCall = 'https://api.rasterwise.com/v1/get-screenshot';
  //     apiCall += `?apikey=${getScreenshots.API_KEY}`;
  //     apiCall += `&url=${encodeURIComponent(targetUrl)}`;
  //     apiCall += `&height=960&width=540&waitfor=true`;
  //     console.log('apiCall is', apiCall);
  //     const resp = await axios({ method: 'GET', url: apiCall, timeout: 30000 });
  //     console.log(resp.data);
  //     return axios({ method: 'GET', url: resp.data.screenshotImage, responseType: 'stream' }).then(
  //       imgResp =>
  //         imgResp.data.pipe(
  //           fs.createWriteStream(`./screenshots/screenshot_${year}_${deviceId}_${side}.png`)
  //         )
  //     );
  //   };
  //   await grabScreenshot('2019', 'CFF14B99-B153-490D-A9C2-DBB892FDFB87', 'L');
  // })();