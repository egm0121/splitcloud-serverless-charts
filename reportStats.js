const GAReporting = require('./reportingClient');

async function fetchGaReport(startDate = '30daysAgo',endDate = '1daysAgo', 
  segmentName = 'ALL_USERS', eventType = 'PLAYBACK-COMPLETED', dimension = 'ga:date' ,limit = 1000 ) {
  const dimensionPayloadMap = {
    'PLAYBACK-COMPLETED': {
      dimensionName: 'ga:eventAction',
      operator: 'EXACT',
      expressions: ['playback-completed'],
    },
    'POSITIVE-ACTION' : {
      dimensionName: 'ga:eventAction',
      operator: 'EXACT',
      expressions: ['INCREMENT_POSITIVE_ACTION'],
    },
    'AD-STARTED' : {
      dimensionName: 'ga:eventAction',
      operator: 'EXACT',
      expressions: ['REWARDED_AD_STARTED'],
    },
    'SHARE-COMPLETED': {
      dimensionName: 'ga:eventAction',
      operator: 'EXACT',
      expressions: ['SET_SOCIAL_SHARE_COMPLETED'],
    }
  };
  const segmentsMap = {
    'ALL_USERS':'gaid::-1',
    'NEW_USERS':'gaid::-2',
    'RETURN_USERS':'gaid::-3',
  }
  const segmentId =  segmentsMap[segmentName];
  const dimensionFilter = dimensionPayloadMap[eventType];
  const reportingClient = await GAReporting.initReportingClient();
  const reportRequest = {
    requestBody: {
      reportRequests: [
        {
          viewId: '152777884',
          dateRanges: [
            {
              startDate,
              endDate,
            },
          ],
          metrics: [
            {
              expression: 'ga:totalEvents',
            },
            {
              expression: 'ga:users',
            },
          ],
          dimensions: [
            {
              name: dimension,
            },
            {
              name: 'ga:segment'
            }
          ],
          orderBys: [
            { fieldName: dimension, sortOrder: 'DESCENDING' },
          ],
          pageSize: `${limit}`,
          dimensionFilterClauses : [
            {
              filters: [
                dimensionFilter
              ],
            },
          ],
          segments:  [{'segmentId': segmentId}]
        },
      ],
    },
  };
  
  const res = await reportingClient.reports.batchGet(reportRequest);
  return res;
}

function extractResponseRows(response) {
  return response.data.reports[0].data.rows.map(row => {
    const [totalPlays, totalUsers] = row.metrics[0].values;
    return {
      date: row.dimensions[0],
      average: Math.round(parseInt(totalPlays) / parseInt(totalUsers)),
    };
  });
}

module.exports = {
  getAvgEventCount: async function (...args){
    const reportData = await fetchGaReport( ...args );
    return extractResponseRows(reportData);
  }
} 