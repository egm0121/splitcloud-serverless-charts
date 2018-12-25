'use strict';

const {google} = require('googleapis');
const sampleClient = require('../sampleclient');

const analyticsreporting = google.analyticsreporting({
  version: 'v4',
  auth: sampleClient.oAuth2Client,
});

async function runSample() {
  const res = await analyticsreporting.reports.batchGet({
    requestBody: {
      reportRequests: [
        {
          viewId: '65704806',
          dateRanges: [
            {
              startDate: '2018-03-17',
              endDate: '2018-03-24',
            },
            {
              startDate: '14daysAgo',
              endDate: '7daysAgo',
            },
          ],
          metrics: [
            {
              expression: 'ga:users',
            },
          ],
        },
      ],
    },
  });
  console.log(res.data);
  return res.data;
}

const scopes = ['https://www.googleapis.com/auth/analytics'];
sampleClient
  .authenticate(scopes)
  .then(runSample)
  .catch(console.error);

// export functions for testing purposes
module.exports = {
  runSample,
  client: sampleClient.oAuth2Client,
};