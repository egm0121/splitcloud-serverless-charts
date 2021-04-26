const { performance } = require('perf_hooks');
const fs = require('fs');
const axios = require('axios');
const moment = require('moment');
const chartService = require('../src/modules/chartsService');
const discoverApi = require('../src/modules/discoverApi');
const reportStats = require('../src/modules/reportStats');
const constants = require('../src/constants/constants');
const getScreenshots = require('../key/getScreenshots');
const DeviceReports = require('../src/modules/deviceReports');
const SoundCloudChartsService = require('../src/modules/SoundCloudChartsService').default;
const RawEventsExtractor = require('../src/modules/RawEventsExtractor');

const logTracks = tracks => {
  console.log(
    't.id',
    't.title',
    't.splitcloud_total_plays',
    't.splitcloud_unique_plays',
    't.score'
  );
  tracks.map(t =>
    console.log(
      JSON.stringify({
        id: t.id,
        score: t.score,
        daysAgo: t.daysDistance,
        sc_plays_log: Math.log(t.playback_count),
        title: t.title,
        genre: t.genre,
        username: t.username,
        duration: moment(t.duration).format('mm:ss'),
        unique_play: t.splitcloud_unique_plays,
        total_play: t.splitcloud_total_plays,
      })
    )
  );
  return tracks;
};
(async () => {
  const timeStart = performance.now();
  const currDate = moment().format('L');
  // await chartService.getTrendingChart().then(logTracks);
  // await SoundCloudChartsService.getPopularChart().then(logTracks);
  // console.log('TRENDING on ', currDate);
  const country = 'United States';
  // console.log('POPULAR on ', currDate, ' country ', country);
  // await chartService.getTrendingChart(50, country).then(logTracks);
  // await chartService.getTopChart(50, country, '7daysAgo').then(logTracks);
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
  // const deviceId = 'FB12F7C8-1D13-421C-9027-0F068262D6D9'; // giphone
  // const deviceId = 'c23ecb15ab837b84'; // gandroid
  // const deviceId = 'F80A9F98-07F7-45EC-9C5B-C4F9BAA19FEF'; // piphone
  // const deviceId = '1e3e5ed0634a86c3';
  // const topTracks = await chartService.getPopularTracksByDeviceId(25, '2020-01-01', deviceId, 'L');
  // const topSearchTerms = await chartService.getTopSearchTermsByCountry(
  //   3,
  //   constants.TOP_COUNTRIES.ES
  // );
  // logTracks(topSearchTerms);
  // const activeDevices = await DeviceReports.getActiveDevices(15, undefined, '60daysAgo');
  // console.log(JSON.stringify(activeDevices.map(e => e.dimensions[0])));
  // console.log('active devices:', activeDevices.length);
  // logTracks(await chartService.getYearlyPopularTrackByDeviceId(10, deviceId, 'L'));
  // logTracks(await chartService.getYearlyPopularTrackByCountry(10, 'India'));
  const rawEvents = await RawEventsExtractor.fetchDailyEvents('1DaysAgo');
  console.log(rawEvents.length);
  console.log(
    rawEvents
      .slice(0, 10)
      .map(res => res.dimensions.concat(res.metrics).join(','))
      .join('\n')
  );
  console.log('Time taken', (performance.now() - timeStart) / 1000);
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
})();
