const axios = require('axios');
const neatCsv = require('neat-csv');
const fs = require('fs');

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
const csvFilePath =  __dirname + '/splitcloud-app_total_x_device_20190101-20191210.csv';
const MAX_LIMIT = Infinity;
const BATCH_SIZE = 4;
(async () => {
  const idsMap = await neatCsv(fs.readFileSync(csvFilePath));
  const validIds = idsMap
    .filter(item => parseInt(item[1], 10) >= 50)
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
      const allResolved = await Promise.all(batch.map(id => fetchSidesForId(id)));
      return allResolved;
    }
  });
  // eslint-disable-next-line
  for(let chunk of toThunkList){
    // eslint-disable-next-line no-await-in-loop
    await chunk();
  }
})();
