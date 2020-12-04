const GAReporting = require('./reportingClient');

const dimensionPayloadMap = {
  'PLAYBACK-COMPLETED': {
    dimensionName: 'ga:eventAction',
    operator: 'EXACT',
    expressions: ['playback-completed'],
  },
  'POSITIVE-ACTION': {
    dimensionName: 'ga:eventAction',
    operator: 'EXACT',
    expressions: ['INCREMENT_POSITIVE_ACTION'],
  },
  'AD-STARTED': {
    dimensionName: 'ga:eventAction',
    operator: 'EXACT',
    expressions: ['REWARDED_AD_STARTED'],
  },
  'SHARE-COMPLETED': {
    dimensionName: 'ga:eventAction',
    operator: 'EXACT',
    expressions: ['SET_SOCIAL_SHARE_COMPLETED'],
  },
};
const customDimensionsMap = {
  song_id: 'ga:dimension1',
  device_id: 'ga:dimension2',
  timestamp: 'ga:dimension3',
  device_model: 'ga:dimension4',
  app_playback_mode: 'ga:dimension5',
  from_scene: 'ga:dimension6',
};
const segmentsMap = {
  ALL_USERS: 'gaid::-1',
  NEW_USERS: 'gaid::-2',
  RETURN_USERS: 'gaid::-3',
};

async function fetchGaReport(
  startDate = '30daysAgo',
  endDate = '1daysAgo',
  segmentId = segmentsMap.ALL_USERS,
  filterEvent = 'PLAYBACK-COMPLETED',
  dimension = customDimensionsMap.song_id,
  metricFilters = [],
  metrics = ['ga:totalEvents'],
  limit = 100000
) {
  const dimensionFilter = dimensionPayloadMap[filterEvent];
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
          metrics: metrics.map(metricName => ({ expression: metricName })),
          dimensions: [
            {
              name: dimension,
            },
            {
              name: 'ga:segment',
            },
          ],
          orderBys: [
            {
              fieldName: metrics[0],
              sortOrder: 'DESCENDING',
            },
          ],
          pageSize: `${limit}`,
          dimensionFilterClauses: [
            {
              filters: [dimensionFilter],
            },
          ],
          metricFilterClauses: [
            {
              filters: metricFilters,
            },
          ],
          segments: [{ segmentId }],
        },
      ],
    },
  };
  console.log('fetch GA Report', JSON.stringify(reportRequest));
  const res = await reportingClient.reports.batchGet(reportRequest);
  return res;
}

function extractResponseRows(response) {
  return response.data.reports[0].data.rows.map(row => {
    return {
      dimensions: row.dimensions,
      metrics: row.metrics[0].values,
    };
  });
}

module.exports = {
  async getActiveDevices(
    minPlaybackCompleted = 25, // count as active devices only the ones that played 25+ tracks in last 2 months
    segment = segmentsMap.RETURN_USERS,
    since = '60daysAgo'
  ) {
    const filterMininmumPlaybacks = {
      metricName: 'ga:totalEvents',
      operator: 'GREATER_THAN',
      comparisonValue: `${minPlaybackCompleted - 1}`,
    };
    const reportData = await fetchGaReport(
      since,
      '1daysAgo',
      segment,
      'PLAYBACK-COMPLETED',
      customDimensionsMap.device_id,
      filterMininmumPlaybacks
    );
    return extractResponseRows(reportData);
  },
};
