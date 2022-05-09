const axios = require('axios');
const GAReporting = require('./reportingClient');
const availableStreamTokens = require('../../key/all_stream_tokens.json').filter(
  tokenInfo => tokenInfo.SC_CLIENT_SECRET
); // only use own tokens with a client secret
const helpers = require('./helpers');

const INITIAL_ACTIVE_CLIENT_ID = availableStreamTokens[1].SC_CLIENT_ID;
const ACTIVE_TOKEN_S3_PATH_V2 = 'app/app_config_v2.json';
const TEST_TRACK_URL = 'https://api.soundcloud.com/tracks/855191668/streams';
const MIN_EXPIRE_TIME = 5 * 60 * 1e3; // expire token 5 minutes before sc expiry

async function getActiveToken() {
  let jsonData;
  try {
    jsonData = await helpers.readJSONFromS3(ACTIVE_TOKEN_S3_PATH_V2);
  } catch (err) {
    console.log('error reading active token -', ACTIVE_TOKEN_S3_PATH_V2);
    return false;
  }
  return jsonData;
}

async function checkTokenIsValid(token, expireAt) {
  let retValue = 'valid';
  try {
    console.log('checkTokenIsValid:', token);
    if (!token) return 'expired';
    if (expireAt - Date.now() < MIN_EXPIRE_TIME) return 'expired';
    const resp = await axios({
      method: 'get',
      url: TEST_TRACK_URL,
      headers: {
        Authorization: `OAuth ${token}`,
      },
      validateStatus: status => status >= 200 && status <= 302,
    });
    if (resp.status >= 400) {
      retValue = 'expired';
    }
    if (resp.status === 429) {
      retValue = 'max_quota';
    }
  } catch (err) {
    console.error('checkTokenIsValid got error', err, err.response);
    if (err && err.response && err.response.status === 429) {
      retValue = 'max_quota';
    } else {
      retValue = 'expired';
    }
  }
  console.log('checkTokenIsValid returned:', retValue);
  return retValue;
}

async function fetchAccessTokenForClientId(clientId) {
  let accessTokenObj = {};
  try {
    const clientSecret = (
      availableStreamTokens.find(token => token.SC_CLIENT_ID === clientId) || {}
    ).SC_CLIENT_SECRET;
    const postParams = new URLSearchParams();
    postParams.append('client_id', clientId);
    postParams.append('client_secret', clientSecret);
    postParams.append('grant_type', 'client_credentials');
    const resp = await axios({
      method: 'POST',
      url: 'https://api.soundcloud.com/oauth2/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: postParams.toString(),
    });
    accessTokenObj = {
      token: resp.data.access_token,
      exp: Date.now() + parseInt(resp.data.expires_in, 10) * 1e3,
    };
  } catch (err) {
    console.error('fetchAccessToken failed', err.response);
  }
  return accessTokenObj;
}

async function setActiveToken(currClientId, currAccessToken, currAccessExp) {
  let toSerialize = {};
  try {
    toSerialize = await helpers.readJSONFromS3(ACTIVE_TOKEN_S3_PATH_V2);
  } catch (err) {
    console.error('error reading active token payload', ACTIVE_TOKEN_S3_PATH_V2);
  }
  toSerialize.STREAM_CLIENT_ID = currClientId; // updates fields while preserving existing config keys
  toSerialize.STREAM_ACCESS_TOKEN = currAccessToken;
  toSerialize.STREAM_ACCESS_EXP = currAccessExp;
  return helpers.saveFileToS3(ACTIVE_TOKEN_S3_PATH_V2, toSerialize);
}

async function getUsageByClientId(metricsLogger) {
  const reportingClient = await GAReporting.initReportingClient();
  const tokenUsageReport = await reportingClient.reports.batchGet({
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
  const rows = tokenUsageReport.data.reports[0].data.rows; //eslint-disable-line
  let tokenWithUsage = {};
  if (rows && Array.isArray(rows)) {
    tokenWithUsage = rows.reduce((obj, row) => {
      obj[row.dimensions[0]] = parseInt(row.metrics[0].values[0], 10); //eslint-disable-line
      return obj;
    }, {});
  } else {
    console.log('got invalid token hits from GA', rows);
    metricsLogger.putMetric('failedTokenReportReq', 1);
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
  const tokensUsageObj = await getUsageByClientId(metricsLogger);
  const activeTokenObj = await getActiveToken();
  let activeClientId;
  let activeAccessToken;
  console.log('current Stream Token in usage', activeTokenObj);
  if (!activeTokenObj || !activeTokenObj.STREAM_CLIENT_ID || !activeTokenObj.STREAM_ACCESS_TOKEN) {
    console.log('no access token found, setting default:', INITIAL_ACTIVE_CLIENT_ID);
    activeClientId = INITIAL_ACTIVE_CLIENT_ID;
  } else {
    activeClientId = activeTokenObj.STREAM_CLIENT_ID;
    activeAccessToken = activeTokenObj.STREAM_ACCESS_TOKEN;
  }
  // check validity of current accessToken
  const tokenValidityState = await checkTokenIsValid(
    activeAccessToken,
    activeTokenObj && activeTokenObj.STREAM_ACCESS_EXP
  );
  console.log('isTokenStillValid', activeAccessToken, 'result:', tokenValidityState);
  // if current token expired or quota has been exceeded for the current clientId
  // select the least used clientId from the pool.
  if (tokenValidityState === 'max_quota' || tokenValidityState === 'expired') {
    console.log('current clientId above quota, select new clientId from', tokensUsageObj);
    const tokensUsageMap = Object.keys(tokensUsageObj)
      .map(key => [key, tokensUsageObj[key]])
      .filter(tokenInfo => tokenInfo[0] !== activeTokenObj.STREAM_CLIENT_ID) // filter out current token
      .sort((a, b) => a[1] - b[1]); // sort by least used first

    let newValidTokenFound = false;
    // eslint-disable-next-line no-restricted-syntax
    for (const currClientIdInfo of tokensUsageMap) {
      const currClientId = currClientIdInfo[0];
      console.log('potential new clientId, validate it', currClientId);
      // eslint-disable-next-line no-await-in-loop
      const accessTokenForClient = await fetchAccessTokenForClientId(currClientId);
      // eslint-disable-next-line no-await-in-loop
      const newTokenValidityState = await checkTokenIsValid(
        accessTokenForClient.token,
        accessTokenForClient.exp
      );
      if (newTokenValidityState === 'valid') {
        console.log(
          'valid new token found',
          accessTokenForClient.token,
          'for clientId',
          currClientId,
          'set it as active'
        );
        newValidTokenFound = true;
        // eslint-disable-next-line no-await-in-loop
        await setActiveToken(currClientId, accessTokenForClient.token, accessTokenForClient.exp);
        metricsLogger.putMetric('tokenSwap', 1);
        break;
      }
    }
    metricsLogger.putMetric('tokenPoolExausted', newValidTokenFound ? 0 : 1);
    return getActiveToken();
  }
  console.log(`active clientId ${activeClientId} is still below hit limit`);
  return activeTokenObj;
}

module.exports = selectActiveStreamToken;
