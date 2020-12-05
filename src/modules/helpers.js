const crypto = require('crypto');
const AWS = require('aws-sdk');
const constants = require('../constants/constants');

AWS.config.update({ region: 'us-east-1' });
const isDEV = process.env.STAGE === 'dev';
const s3 = new AWS.S3();
const SNS = new AWS.SNS();
const getQueryParam = (event, param) => {
  return event.queryStringParameters && event.queryStringParameters[param];
};
const sqs = new AWS.SQS({ apiVersion: 'latest' });

async function pushToTopic(messageObj, topic) {
  console.log('push message to topic', topic);
  return SNS.publish({
    Message: messageObj.MessageBody,
    MessageAttributes: messageObj.MessageAttributes,
    TopicArn: topic,
  }).promise();
}
async function saveBlobToS3(keyName, buffer, format = 'image/png') {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('will write binary to s3 key:', finalKeyName);
  return s3
    .putObject({
      Bucket: process.env.BUCKET,
      ContentType: format,
      CacheControl: 'max-age=0,must-revalidate',
      Key: finalKeyName,
      Body: buffer,
    })
    .promise();
}
async function saveFileToS3(keyOrObj, data, stringify = true) {
  let keyName = keyOrObj;
  let bucketName = process.env.BUCKET;
  if (typeof keyOrObj === 'object') {
    // eslint-disable-next-line prefer-destructuring
    keyName = keyOrObj.keyName;
    bucketName = keyOrObj.bucket;
  }
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('will write to s3 key:', finalKeyName);
  return s3
    .putObject({
      Bucket: bucketName,
      ContentType: 'application/json',
      CacheControl: 'max-age=0,must-revalidate',
      Key: finalKeyName,
      Body: stringify ? JSON.stringify(data) : data,
    })
    .promise();
}
async function readFileFromS3(keyOrObj) {
  let keyName = keyOrObj;
  let bucketName = process.env.BUCKET;
  if (typeof keyOrObj === 'object') {
    // eslint-disable-next-line prefer-destructuring
    keyName = keyOrObj.keyName;
    bucketName = keyOrObj.bucket;
  }
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('readFileFromS3:', finalKeyName);
  let resp;
  try {
    resp = await s3
      .getObject({
        Bucket: bucketName,
        Key: finalKeyName,
      })
      .promise();
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      console.log('readFileFromS3 no such key:', finalKeyName);
    } else {
      console.error('readFileFromS3 failed with error:', finalKeyName, err.message);
    }
    throw err;
  }
  return resp.Body.toString();
}
async function writeS3Cache(keyName, value, ttl = 'ttl7', stringify = true) {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('will write to s3 cache bucket:', finalKeyName);
  return s3
    .putObject({
      Bucket: process.env.CACHE_BUCKET,
      ContentType: 'application/json',
      CacheControl: 'max-age=0,must-revalidate',
      Key: finalKeyName,
      Body: stringify ? JSON.stringify(value) : value,
      Tagging: `${ttl}=1`,
    })
    .promise();
}
async function readS3Cache(keyName) {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('readS3Cache:', finalKeyName);
  let resp;
  try {
    resp = await s3
      .getObject({
        Bucket: process.env.CACHE_BUCKET,
        Key: finalKeyName,
      })
      .promise();
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      console.log('readS3Cache: cache miss', finalKeyName);
      return null;
    }
    console.warn('readS3Cache: error', err);
    return null;
  }
  return JSON.parse(resp.Body.toString());
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
function getStringScripts(str) {
  return constants.SUPPORTED_UNICODE_SCRIPTS.filter(scriptObj => str.match(scriptObj.regexp)).map(
    scriptObj => scriptObj.name
  );
}

function isStringNumeric(str) {
  return str.match(/\p{Number}/u);
}

function arrayIntersect(a, b) {
  return a.filter(item => b.includes(item));
}
module.exports = {
  saveFileToS3,
  saveBlobToS3,
  readFileFromS3,
  readJSONFromS3,
  writeS3Cache,
  readS3Cache,
  getQueryParam,
  isDEV,
  sqs,
  arrayInPlaceShuffle,
  arrayIntersect,
  selectVariantFromDeviceId,
  selectVariantFromHash,
  pushToTopic,
  getStringScripts,
  isStringNumeric,
};
