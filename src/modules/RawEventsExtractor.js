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
  event_label: 'ga:eventLabel',
  event_category: 'ga:eventCategory',
  song_id: 'ga:dimension1',
  device_id: 'ga:dimension2',
  timestamp: 'ga:dimension3',
  device_model: 'ga:dimension4',
  app_playback_mode: 'ga:dimension5',
  from_scene: 'ga:dimension6',
  countryCode: 'ga:countryIsoCode',
};
async function fetchGaReport(
  startDate = '30daysAgo',
  endDate = '1daysAgo',
  filterDimension = 'PLAYBACK-COMPLETED',
  extractDimensions = [
    customDimensionsMap.timestamp,
    customDimensionsMap.device_id,
    customDimensionsMap.event_category,
    customDimensionsMap.event_label,
    customDimensionsMap.song_id,
    customDimensionsMap.app_playback_mode,
    customDimensionsMap.countryCode,
  ],
  metrics = ['ga:totalEvents'],
  limit = 100000
) {
  const dimensionFilter = dimensionPayloadMap[filterDimension];
  const reportingClient = await GAReporting.initReportingClient();
  const reportRequest = {
    requestBody: {
      reportRequests: [
        {
          viewId: '152777884',
          samplingLevel: 'LARGE',
          dateRanges: [
            {
              startDate,
              endDate,
            },
          ],
          metrics: metrics.map(metricName => ({ expression: metricName })),
          dimensions: extractDimensions.map(dimName => ({ name: dimName })),
          orderBys: [
            {
              fieldName: metrics[0],
              sortOrder: 'DESCENDING',
            },
          ],
          pageSize: `${limit}`,
          hideValueRanges: true,
          hideTotals: true,
          includeEmptyRows: true,
          dimensionFilterClauses: [
            {
              filters: [dimensionFilter],
            },
          ],
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
  async fetchDailyEvents(date, eventName = 'PLAYBACK-COMPLETED', extractDimensions) {
    const reportData = await fetchGaReport(date, date, eventName, extractDimensions);
    if (reportData.data.reports[0].data.samplesReadCounts) {
      console.error(`results for ${date} - ${eventName} are sampled!`);
    }
    return extractResponseRows(reportData);
  },
};
