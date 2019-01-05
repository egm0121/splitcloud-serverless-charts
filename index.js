const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const moment = require('moment');
const privatekey = require('./key/splitcloud-lambda-04bda8c26386.json');
const soundcloudkey = require('./key/soundcloud_key.json');

const SC_API_ENDPOINT = 'api.soundcloud.com';
function generateAuthClient() {
  const jwtClient = new google.auth.JWT(privatekey.client_email, null, privatekey.private_key, [
    'https://www.googleapis.com/auth/analytics.readonly',
  ]);
  // authenticate request
  return jwtClient.authorize().then(resToken => {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: resToken.access_token,
    });
    return oauth2Client;
  });
}

async function fetchAnalyticsReport(authClient, limit = 50) {
  const analyticsreporting = google.analyticsreporting({
    version: 'v4',
    auth: authClient,
  });

  const res = await analyticsreporting.reports.batchGet({
    requestBody: {
      reportRequests: [
        {
          viewId: '152777884',
          dateRanges: [
            {
              startDate: '7daysAgo',
              endDate: '0daysAgo',
            },
          ],
          metrics: [
            {
              expression: 'ga:totalEvents',
            },
            {
              expression: 'ga:uniqueEvents',
            },
          ],
          dimensions: [
            {
              name: 'ga:dimension1',
            },
          ],
          orderBys: [
            { fieldName: 'ga:uniqueEvents', sortOrder: 'DESCENDING' },
            { fieldName: 'ga:totalEvents', sortOrder: 'DESCENDING' },
          ],
          pageSize: `${limit}`,
        },
      ],
    },
  });
  return res;
}
async function fetchScTrackById(trackId) {
  const trackUrl = `http://${SC_API_ENDPOINT}/tracks/${trackId}?client_id=${
    soundcloudkey.SC_CLIENT_ID
  }`;
  return axios({ method: 'GET', url: trackUrl, timeout: 1000 });
}
async function hydrateSoundcloudTracks(trackList) {
  const finalTracks = {};
  return trackList
    .map(track => {
      const resolveTrack = Object.assign({}, track);
      resolveTrack.fetch = () => fetchScTrackById(track.id);
      return resolveTrack;
    })
    .reduce((prevPromise, nextTrackObj, idx, initList) => {
      const currTrackObj = initList[idx - 1];
      return prevPromise
        .then(resp => {
          if (resp) {
            finalTracks[currTrackObj.id] = Object.assign({}, currTrackObj, resp.data);
          }
          return nextTrackObj.fetch();
        })
        .catch(err => {
          console.warn(`sc track ${currTrackObj.id} retrival failed`, err.message);
          return Promise.resolve();
        });
    }, Promise.resolve())
    .then(() => Object.values(finalTracks));
}
function extractResponseRows(response) {
  return response.data.reports[0].data.rows.map(row => {
    const [totalPlays, uniquePlays] = row.metrics[0].values;
    return {
      id: row.dimensions[0],
      splitcloud_total_plays: parseInt(totalPlays, 10),
      splitcloud_unique_plays: parseInt(uniquePlays, 10),
    };
  });
}
function decayTimeFunc(x) {
  return Math.exp(-13 * x * x);
}
function calulateBaseScore(item) {
  return Math.floor(
    item.splitcloud_total_plays + item.splitcloud_unique_plays * 2 + Math.log(item.playback_count)
  );
}
function calculateTrendingScore(item) {
  const daysDistance = Math.min(moment().diff(moment(new Date(item.created_at)), 'days'), 1535);
  const decayFactor = decayTimeFunc(daysDistance / 365);
  return Object.assign({}, item, {
    score: calulateBaseScore(item) * decayFactor,
    decayFactor,
    daysDistance,
  });
}
function calculatePopularityScore(item) {
  return Object.assign({}, item, { score: calulateBaseScore(item) });
}
function byScore(a, b) {
  return b.score - a.score;
}
function sortByPopularity(rows) {
  return rows.map(calculatePopularityScore).sort(byScore);
}
function sortByPopularityWithDecay(rows) {
  return rows.map(calculateTrendingScore).sort(byScore);
}
module.exports = {
  getTopChart(limit = 50) {
    return generateAuthClient()
      .then(authClient => fetchAnalyticsReport(authClient, limit))
      .then(extractResponseRows)
      .then(hydrateSoundcloudTracks)
      .then(sortByPopularity);
  },
  getTrendingChart() {
    return this.getTopChart(100)
      .then(sortByPopularityWithDecay)
      .then(chart => chart.slice(0, 50));
  },
  sortTrendingTracks(tracks) {
    return sortByPopularityWithDecay(tracks);
  },
  saveChartToFile(jsonFileName = './top_splitcloud_tracks.json') {
    return this.getTopChart()
      .then(tracks => {
        fs.writeFileSync(jsonFileName, JSON.stringify(tracks));
        return tracks;
      })
      .then(tracks => {
        tracks.map(t =>
          console.log(t.id, t.title, t.splitcloud_total_plays, t.splitcloud_unique_plays, t.score)
        );
        return tracks;
      });
  },
};
