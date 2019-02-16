const fs = require('fs');
const GAReporting = require('./reportingClient');
const availableStreamTokens = require('./key/all_stream_tokens.json');
const activeDevToken = require('./app_config.json');
const helpers = require('./helpers');

const INITIAL_ACTIVE_TOKEN = availableStreamTokens[1].SC_CLIENT_ID;
const MAX_USAGE_PER_DAY = 13000;

async function getActiveToken() {
  if (process.env.BUCKET) {
    let jsonData;
    try {
      jsonData = await helpers.readJSONFromS3('app/app_config.json');
    } catch (err) {
      console.log('error reading active token - app/app_config.json');
      return false;
    }
    return jsonData.STREAM_CLIENT_ID;
  }
  return activeDevToken.STREAM_CLIENT_ID;
}

async function setActiveToken(currToken) {
  const toSerialize = { STREAM_CLIENT_ID: currToken };
  if (process.env.BUCKET) {
    return helpers.saveFileToS3('app/app_config.json', toSerialize);
  }
  return fs.writeFileSync('./app_config.json', JSON.stringify(toSerialize));
}
function getUsageByToken(data) {
  const rows = data.reports[0].data.rows; //eslint-disable-line
  const tokenWithUsage = rows.reduce((obj, row) => {
    obj[row.dimensions[0]] = parseInt(row.metrics[0].values[0], 10); //eslint-disable-line
    return obj;
  }, {});
  const validTokensMap = {};
  availableStreamTokens.forEach(tokenObj => {
    const token = tokenObj.SC_CLIENT_ID;
    validTokensMap[token] = tokenWithUsage[token] || 0;
  });
  return validTokensMap;
}
async function selectActiveStreamToken() {
  const reportingClient = await GAReporting.initReportingClient();
  const tokenUsage = await reportingClient.reports.batchGet({
    requestBody: {
      reportRequests: [
        {
          viewId: '152777884',
          dateRanges: [
            {
              startDate: '0daysAgo',
              endDate: '0daysAgo',
            },
          ],
          metrics: [
            {
              expression: 'ga:totalEvents',
            },
          ],
          dimensions: [
            {
              name: 'ga:eventLabel',
            },
          ],
          dimensionFilterClauses: [
            {
              filters: [
                {
                  dimensionName: 'ga:eventAction',
                  operator: 'EXACT',
                  expressions: ['SC_STREAM_TOKEN_HIT'],
                },
              ],
            },
          ],
          orderBys: [{ fieldName: 'ga:totalEvents', sortOrder: 'DESCENDING' }],
        },
      ],
    },
  });
  const tokensUsageObj = getUsageByToken(tokenUsage.data);
  const activeToken = await getActiveToken();
  console.log('current Stream Token in usage', activeToken);
  if (!activeToken) {
    console.log('no active token found, setting default:', INITIAL_ACTIVE_TOKEN);
    return setActiveToken(INITIAL_ACTIVE_TOKEN);
  }
  console.log(tokensUsageObj);
  if (tokensUsageObj[activeToken] > MAX_USAGE_PER_DAY) {
    const tokensUsageMap = Object.keys(tokensUsageObj)
      .map(key => [key, tokensUsageObj[key]])
      .sort((a, b) => a[1] - b[1]);
    console.log('setting active token to :', tokensUsageMap[0][0]);
    setActiveToken(tokensUsageMap[0][0]);
    return tokensUsageMap[0][0];
  }
  console.log(`active token ${activeToken} is still below hit limit`);
  return activeToken;
}

module.exports = selectActiveStreamToken;
