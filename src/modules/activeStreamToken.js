const axios = require('axios');
const GAReporting = require('./reportingClient');
const availableStreamTokens = require('../../key/all_stream_tokens.json');
const helpers = require('./helpers');

const INITIAL_ACTIVE_TOKEN = availableStreamTokens[1].SC_CLIENT_ID;
const ACTIVE_TOKEN_S3_PATH_V2 = 'app/app_config_v2.json';
const MAX_USAGE_PER_DAY = 13000;
const TEST_TRACK_URL = 'https://api.soundcloud.com/tracks/855191668/stream';

async function getActiveToken() {
  let jsonData;
  try {
    jsonData = await helpers.readJSONFromS3(ACTIVE_TOKEN_S3_PATH_V2);
  } catch (err) {
    console.log('error reading active token -', ACTIVE_TOKEN_S3_PATH_V2);
    return false;
  }
  return jsonData.STREAM_CLIENT_ID;
}

async function checkTokenIsValid(token) {
  let isValid = true;
  try {
    const url = `${TEST_TRACK_URL}?client_id=${token}`;
    console.log('checkToken url:', url);
    const resp = await axios({
      method: 'get',
      url,
      validateStatus: status => status >= 200 && status <= 302,
    });
    console.log('checkToken got response', resp.status, resp.headers);
    isValid = resp.status !== 429;
  } catch (err) {
    console.log('checkToken got error', err.response && err.response.status);
    isValid = err.response && err.response.status !== 429;
  }
  return isValid;
}

async function setActiveToken(currToken) {
  const toSerialize = { STREAM_CLIENT_ID: currToken };
  return helpers.saveFileToS3(ACTIVE_TOKEN_S3_PATH_V2, toSerialize);
}
function getUsageByToken(data) {
  const rows = data.reports[0].data.rows; //eslint-disable-line
  let tokenWithUsage = {};
  if (rows && Array.isArray(rows)) {
    tokenWithUsage = rows.reduce((obj, row) => {
      obj[row.dimensions[0]] = parseInt(row.metrics[0].values[0], 10); //eslint-disable-line
      return obj;
    }, {});
  } else {
    console.log('got invalid token hits from GA', rows);
  }
  const validTokensMap = {};
  availableStreamTokens.forEach(tokenObj => {
    const token = tokenObj.SC_CLIENT_ID;
    validTokensMap[token] = tokenWithUsage[token] || 0;
  });
  return validTokensMap;
}

async function selectActiveStreamToken(metricsLogger) {
  metricsLogger.setNamespace('splitcloud-selectActiveToken');
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
  const isTokenPastUsageLimit = tokensUsageObj[activeToken] >= MAX_USAGE_PER_DAY;
  console.log(tokensUsageObj, 'isTokenStillValid', activeToken, isTokenStillValid);
  if (!isTokenStillValid || isTokenPastUsageLimit) {
    console.log('current token failed validation', { isTokenStillValid, isTokenPastUsageLimit });
    const tokensUsageMap = Object.keys(tokensUsageObj)
      .map(key => [key, tokensUsageObj[key]])
      .filter(tokenInfo => tokenInfo[0] !== activeToken) // filter out current token
      .sort((a, b) => a[1] - b[1]); // sort by least used first

    let newToken;
    // eslint-disable-next-line no-restricted-syntax
    for (const currTokenInfo of tokensUsageMap) {
      console.log('potential new token, validate it', currTokenInfo[0]);
      // eslint-disable-next-line no-await-in-loop
      if (await checkTokenIsValid(currTokenInfo[0])) {
        console.log('valid new token found', currTokenInfo[0], 'set it as active');
        [newToken] = currTokenInfo;
        // eslint-disable-next-line no-await-in-loop
        await setActiveToken(newToken);
        metricsLogger.putMetric('tokenSwap', 1);
        break;
      }
    }
    if (!newToken) {
      console.log(JSON.stringify({ logAlarm: 'allTokenExpired', isError: true }));
    }
    return newToken;
  }
  console.log(`active token ${activeToken} is still below hit limit`);
  return activeToken;
}

module.exports = selectActiveStreamToken;
