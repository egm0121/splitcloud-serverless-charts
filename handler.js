const AWS = require('aws-sdk');
const moment = require('moment');
const chartService = require('./index');

const s3 = new AWS.S3();
async function saveToS3(keyName, data) {
  return s3
    .putObject({
      Bucket: process.env.BUCKET,
      ContentType: 'application/json',
      Key: keyName,
      Body: JSON.stringify(data),
    })
    .promise();
}
module.exports.hello = async () => {
  console.log('Splitcloud-serverless-charts service was called');
  const topChartData = await chartService.getTopChart();
  console.log('try to store data to s3 file bucketName:', process.env.BUCKET);
  let retValue;
  let retValueCopy;
  const weekOfYear = moment().format('W');
  try {
    retValue = await saveToS3('charts/weekly_popular.json', topChartData);
    retValueCopy = await saveToS3(`charts/weekly_popular_${weekOfYear}.json`, topChartData);
  } catch (err) {
    console.log('Uploaded chart to S3 err:', err);
  }
  return {
    statusCode: 200,
    body: {
      success: [retValue, retValueCopy],
    },
  };
};
