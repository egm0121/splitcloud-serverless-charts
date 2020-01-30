const fs = require('fs');
const axios = require('axios');
const GAReporting = require('./reportingClient');
const availableStreamTokens = require('./key/all_stream_tokens.json');
const activeDevToken = require('./app_config.json');
const helpers = require('./helpers');

const INITIAL_ACTIVE_TOKEN = availableStreamTokens[1].SC_CLIENT_ID;
const MAX_USAGE_PER_DAY = 13000;
const TEST_TRACK_URL = 'https://api.soundcloud.com/tracks/397263444/stream';

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

async function checkTokenIsValid(token) {
  let isValid = true;
  try {
    const url = `${TEST_TRACK_URL}?client_id=${token}`;
    console.log('checkToken url:', url);
    const resp = await axios({
      method: 'head',
      url,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status <= 302,
    });
    console.log('checkToken got response', resp.status);
    isValid = resp.status !== 429;
  } catch (err) {
    console.log('checkToken got error', err.response && err.response.status);
    isValid = err.response && err.response.status !== 429;
  }
  return isValid;
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
          viewId: '210440147',
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
  const isTokenStillValid = await checkTokenIsValid(activeToken);
  console.log(tokensUsageObj, 'isTokenStillValid', activeToken, isTokenStillValid);
  if (tokensUsageObj[activeToken] > MAX_USAGE_PER_DAY || !isTokenStillValid) {
    const tokensUsageMap = Object.keys(tokensUsageObj)
      .map(key => [key, tokensUsageObj[key]])
      .sort((a, b) => a[1] - b[1]);
    console.log('setting active token to :', tokensUsageMap[0][0]);
    await setActiveToken(tokensUsageMap[0][0]);
    return tokensUsageMap[0][0];
  }
  console.log(`active token ${activeToken} is still below hit limit`);
  return activeToken;
}

module.exports = selectActiveStreamToken;
