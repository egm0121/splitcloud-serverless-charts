const axios = require('axios');
const neatCsv = require('neat-csv');
const fs = require('fs');
const getScreenshots = require('../key/getScreenshots');

const fetchSidesForId = async id => {
  const baseURL = `https://rest.splitcloud-app.com/wrapped/2019/${id}`;
  console.log('fetching L & R for ', baseURL);
  return Promise.all([
    axios({ method: 'GET', url: `${baseURL}/L`, timeout: 30 * 1e3 }),
    axios({ method: 'GET', url: `${baseURL}/R`, timeout: 30 * 1e3 }),
  ]).catch(err => {
    console.log('ignored error for ', id, ':', err.toString());
    return Promise.resolve();
  });
};
const grabScreenshot = async (year = '2019', deviceId, side) => {
  const targetUrl = `http://www.splitcloud-app.com/wrapped.html?id=${deviceId}&year=${year}&side=${side}&t=3`;
  let apiCall = 'https://api.rasterwise.com/v1/get-screenshot';
  apiCall += `?apikey=${getScreenshots.API_KEY}`;
  apiCall += `&url=${encodeURIComponent(targetUrl)}`;
  apiCall += `&height=960&width=540&waitfor=true`;
  console.log('apiCall is', apiCall);
  const resp = await axios({ method: 'GET', url: apiCall, timeout: 30000 });
  return axios({ method: 'GET', url: resp.data.screenshotImage, responseType: 'stream' }).then(
    imgResp =>
      imgResp.data.pipe(
        fs.createWriteStream(`./screenshots/screenshot_${year}_${deviceId}_${side}.png`)
      )
  );
};
const fetchScreensForId = async id => {
  return Promise.all([grabScreenshot('2019', id, 'L'), grabScreenshot('2019', id, 'R')]);
};

const csvFilePath = __dirname + '/splitcloud-app_total_x_device_20190101-20191210.csv';
const MAX_LIMIT = Infinity;
const MIN_BATCH = 649;
const BATCH_SIZE = 2;
(async () => {
  const idsMap = await neatCsv(fs.readFileSync(csvFilePath));
  const validIds = idsMap
    .filter(item => item[1] && parseInt(item[1].replace(/\D/, ''), 10) >= 50)
    .map(i => i[0])
    .slice(0, MAX_LIMIT);

  const batchOfIds = validIds.reduce((acc, _curr, idx, all) => {
    if (idx % BATCH_SIZE === 0) {
      console.log('adding to batch', idx, idx + BATCH_SIZE);
      return [...acc, all.slice(idx, idx + BATCH_SIZE)];
    }
    return acc;
  }, []);
  const toThunkList = batchOfIds.map((batch, idx) => {
    return async () => {
      console.log('prefetch batch nbr:', idx, 'of ', batchOfIds.length);
      if (idx < MIN_BATCH) return Promise.resolve();
      const allResolved = await Promise.all(
        batch.map(id => {
          // fetchSidesForId(id);
          return fetchScreensForId(id);
        })
      );
      return allResolved;
    };
  });
  console.log(toThunkList.length,'  Batch to process');
  // eslint-disable-next-line
  for(let chunk of toThunkList){
    // eslint-disable-next-line no-await-in-loop
    await chunk();
  }
})();
