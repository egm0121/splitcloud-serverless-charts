const AWS = require('aws-sdk');
const moment = require('moment');
const chartService = require('./index');

const isDEV = process.env.STAGE === 'dev';
const s3 = new AWS.S3();

async function saveToS3(keyName, data) {
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
module.exports.hello = async () => {
  console.log('Splitcloud-serverless-charts service was called');
  const topChartData = await chartService.getTopChart();
  const trendingChartData = await chartService.getTrendingChart();
  console.log('try to store data to s3 file bucketName:', process.env.BUCKET);
  let retValue;
  let retValueCopy;
  const weekOfYear = moment().format('W');
  try {
    if (topChartData.length && trendingChartData.length) {
      console.log('Valide response detected, will update charts');
      retValue = await saveToS3('charts/weekly_popular.json', topChartData);
      retValueCopy = await saveToS3(`charts/weekly_trending.json`, trendingChartData);
    }
    await saveToS3(`charts/weekly_popular_${weekOfYear}.json`, topChartData);
    await saveToS3(`charts/weekly_trending_${weekOfYear}.json`, trendingChartData);
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
