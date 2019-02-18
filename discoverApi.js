const axios = require('axios');
const scKey = require('./key/soundcloud_key.json');
const helpers = require('./helpers');

const SC_GET_DISCOVERY = `http://api-v2.soundcloud.com/selections?client_id=${scKey.SC_CLIENT_ID}`;
const fetchSoundCloudDiscovery = async () =>
  axios({ method: 'GET', url: SC_GET_DISCOVERY, timeout: 5000 });

module.exports = async function discoverApi() {
  const apiResponse = await fetchSoundCloudDiscovery();
  const apiData = apiResponse.data;
  console.log('got api data');
  if (process.env.BUCKET) {
    const s3Path = 'app/api/discovery.json';
    console.log('updated discovery api at path', s3Path);
    return helpers.saveFileToS3(s3Path, apiData);
  }
};
