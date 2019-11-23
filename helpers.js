const AWS = require('aws-sdk');

const isDEV = process.env.STAGE === 'dev';
const s3 = new AWS.S3();
const getQueryParam = (event, param) => {
  return event.queryStringParameters && event.queryStringParameters[param];
};
async function saveFileToS3(keyName, data) {
  const [path, extension] = keyName.split('.');
  const finalKeyName = `${path}${isDEV ? '_dev' : ''}.${extension}`;
  console.log('will write to s3 key:', finalKeyName);
  return s3
    .putObject({
      Bucket: process.env.BUCKET,
      ContentType: 'application/json',
      CacheControl: 'max-age=0,must-revalidate',
      Key: finalKeyName,
      Body: JSON.stringify(data),
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
module.exports = {
  saveFileToS3,
  readFileFromS3,
  readJSONFromS3,
  getQueryParam,
};
