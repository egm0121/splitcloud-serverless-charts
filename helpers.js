const crypto = require('crypto');
const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-1' });
const isDEV = process.env.STAGE === 'dev';
const s3 = new AWS.S3();
const getQueryParam = (event, param) => {
  return event.queryStringParameters && event.queryStringParameters[param];
};
const sqs = new AWS.SQS({ apiVersion: 'latest' });
async function saveFileToS3(keyName, data, stringify = true) {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('will write to s3 key:', finalKeyName);
  return s3
    .putObject({
      Bucket: process.env.BUCKET,
      ContentType: 'application/json',
      CacheControl: 'max-age=0,must-revalidate',
      Key: finalKeyName,
      Body: stringify ? JSON.stringify(data) : data,
    })
    .promise();
}
async function readFileFromS3(keyName) {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('readFileFromS3:', finalKeyName);
  let resp;
  try {
    resp = await s3
      .getObject({
        Bucket: process.env.BUCKET,
        Key: finalKeyName,
      })
      .promise();
  } catch (err) {
    console.error('readFileFromS3 failed with error:', err);
    throw err;
  }
  return resp.Body.toString();
}
async function readJSONFromS3(keyName) {
  let contents;
  try {
    contents = await readFileFromS3(keyName);
  } catch (err) {
    throw err;
  }
  return JSON.parse(contents);
}
function arrayInPlaceShuffle(array) {
  // eslint-disable-next-line no-plusplus
  for (let i = array.length - 1; i > 0; i--) {
    const rand = Math.floor(Math.random() * (i + 1));
    // eslint-disable-next-line no-param-reassign
    [array[i], array[rand]] = [array[rand], array[i]];
  }
}
function selectVariantFromDeviceId(deviceId) {
  const middDigit = parseInt(deviceId[Math.floor(deviceId.length / 2)], 16);
  const lastDigit = parseInt(deviceId[deviceId.length - 1], 16);
  return middDigit + lastDigit < 16;
}
function selectVariantFromHash(str, variants = 2) {
  const hash = crypto
    .createHash('md5')
    .update(str)
    .digest('hex');
  return parseInt(hash.substr(0, 8), 16) % variants;
}
module.exports = {
  saveFileToS3,
  readFileFromS3,
  readJSONFromS3,
  getQueryParam,
  isDEV,
  sqs,
  arrayInPlaceShuffle,
  selectVariantFromDeviceId,
  selectVariantFromHash,
};
