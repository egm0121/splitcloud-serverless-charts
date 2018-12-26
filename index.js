const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const privatekey = require('./key/splitcloud-lambda-04bda8c26386.json');
const soundcloudkey = require('./key/soundcloud_key.json');


const SC_API_ENDPOINT = 'api.soundcloud.com';
function generateAuthClient() {
  const jwtClient = new google.auth.JWT(privatekey.client_email, null, privatekey.private_key, [
    'https://www.googleapis.com/auth/analytics.readonly',
  ]);
  // authenticate request
  return jwtClient.authorize().then(resToken => {
    console.log('Successfully connected!', resToken);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: resToken.access_token,
    });
    return oauth2Client;
  });
}

async function runSample(authClient) {
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
          pageSize: '50',
        },
      ],
    },
  });
  return res;
}
async function fetchScTrackById(trackId){
  const trackUrl = `http://${SC_API_ENDPOINT}/tracks/${trackId}?client_id=${soundcloudkey.SC_CLIENT_ID}`;
  return axios({ method: 'GET', url: trackUrl, timeout: 2000 });
}
async function hydrateSoundcloudTracks(trackList){
  const finalTracks = {};
  return trackList
    .map(track => {
      const resolveTrack = Object.assign({}, track);
      resolveTrack.fetch = () => fetchScTrackById(track.id);
      return resolveTrack;
    })
    .slice(0,10)
    .reduce((prevPromise, nextTrackObj,idx,initList) => {
      const currTrackObj = initList[idx-1];
      return prevPromise.then(resp => {
        if (resp) {
          console.log('hydrate track', currTrackObj.id, 'sc id', resp.data.id);
          finalTracks[currTrackObj.id] = Object.assign({}, currTrackObj, resp.data);
        }
        return nextTrackObj.fetch();
      }).catch(err => {
          console.warn('sc track ' + currTrackObj.id + ' retrival failed', err.message);
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
      debug_id: row.dimensions[0],
      splitcloud_total_plays: totalPlays,
      splitcloud_unique_plays: uniquePlays,
    };
  });
}

generateAuthClient()
  .then(runSample)
  .then(extractResponseRows)
  .then(hydrateSoundcloudTracks)
  .then(tracks => {
    console.log('FINAL TRACKS', tracks);
    fs.writeFileSync('./top_splitcloud_tracks.json',JSON.stringify(tracks));
  })

