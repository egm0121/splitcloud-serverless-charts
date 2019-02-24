const axios = require('axios');
const scKey = require('./key/soundcloud_key.json');
const helpers = require('./helpers');

const SC_API_ENDPOINT = 'http://api.soundcloud.com';
const SC_GET_DISCOVERY = `http://api-v2.soundcloud.com/selections?client_id=${scKey.SC_CLIENT_ID}`;
const fetchSoundCloudDiscovery = async () =>
  axios({ method: 'GET', url: SC_GET_DISCOVERY, timeout: 5000 });

async function resolveSCPlaylistById(scPlaylistId) {
  const apiEndpoint = `${SC_API_ENDPOINT}/playlists/${scPlaylistId}/?client_id=${
    scKey.SC_CLIENT_ID
  }`;
  console.log('request', apiEndpoint);
  let payload;
  try {
    payload = await axios({ method: 'GET', url: apiEndpoint, timeout: 5000 });
  } catch (err) {
    payload = null;
  }
  if (!payload) return null;
  const hasPlayableTracks = payload.data && payload.data.tracks.filter(t => t.streamable).length;
  if (!hasPlayableTracks) return null;
  delete payload.data.tracks;
  
  return payload.data;
}

async function generateDicoverySection(sectionTitle, sectionDescription, playlistsIds) {
  const urnSectionName = sectionTitle.toLowerCase().replace(/(\s|:)/g, '_');
  const id = `splitcloud:selections:custom:${urnSectionName}`;
  const resolvedPlaylists = await Promise.all(playlistsIds.map(resolveSCPlaylistById));
  console.log('resolved playlist data');
  return {
    urn: id,
    id,
    title: sectionTitle,
    description: sectionDescription,
    playlists: resolvedPlaylists,
  };
}
function validateEventData(data) {
  if (!Array.isArray(data)) return false;
  const hasErrors =
    data.filter(
      e => typeof e !== 'object' || !e.sectionName || !e.sectionDescription || !e.playlists.length
    ).length > 0;
  if (hasErrors) return false;
  return true;
}
module.exports = async function discoverApi(eventData) {
  if (eventData && !validateEventData(eventData)) {
    throw new Error('Event Data did not pass validation');
  }

  const apiResponse = await fetchSoundCloudDiscovery();
  const apiData = apiResponse.data;
  const allSectionsResolved = eventData
    ? await Promise.all(
        eventData.map(item =>
          generateDicoverySection(item.sectionName, item.sectionDescription, item.playlists)
        )
      )
    : [];
  apiData.collection = [...allSectionsResolved, ...apiData.collection];
  console.log('allSectionsResolved', allSectionsResolved);
  if (process.env.BUCKET) {
    const s3Path = 'app/api/discovery.json';
    console.log('updated discovery api at path', s3Path);
    return helpers.saveFileToS3(s3Path, apiData);
  }
  return apiData;
};
