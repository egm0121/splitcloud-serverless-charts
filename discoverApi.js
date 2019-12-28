const axios = require('axios');
const scKey = require('./key/soundcloud_key.json');
const helpers = require('./helpers');

const SC_API_ENDPOINT = 'http://api.soundcloud.com';
const SC_GET_DISCOVERY = `http://api-v2.soundcloud.com/mixed-selections?client_id=${
  scKey.SC_CLIENT_ID
}`;
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
function byValidPlaylist(playlist) {
  return !!playlist && playlist.kind === 'playlist';
}
function normalizePlaylistUser(playlist) {
  if (!playlist) return playlist;
  if (playlist && !playlist.user) {
    return {
      ...playlist,
      user: {
        avatar_url: 'https://i1.sndcdn.com/avatars-000600496689-dbv36h-large.jpg',
        first_name: '',
        full_name: '',
        id: 603473631,
        kind: 'user',
        last_modified: '2019-12-17T18:17:23Z',
        last_name: '',
        permalink: 'soundcloud-scenes',
        permalink_url: 'https://soundcloud.com/soundcloud-scenes',
        uri: 'https://api.soundcloud.com/users/603473631',
        urn: 'soundcloud:users:603473631',
        username: 'Scenes',
      },
    };
  }
  return playlist;
}
function byValidSections(item) {
  return item && item.playlists && item.playlists.length;
}
function normalizeScPlaylists(item) {
  if (!item || !item.items || !item.items.collection) return item;
  const normalized = {
    ...item,
    playlists: item.items.collection.filter(byValidPlaylist).map(normalizePlaylistUser),
  };
  delete normalized.items;
  return normalized;
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

  apiData.collection = [
    ...allSectionsResolved,
    ...apiData.collection.map(normalizeScPlaylists).filter(byValidSections),
  ];
  console.log('allSectionsResolved', allSectionsResolved);
  if (process.env.BUCKET) {
    const s3Path = 'app/api/discovery.json';
    console.log('updated discovery api at path', s3Path);
    return helpers.saveFileToS3(s3Path, apiData);
  }
  return apiData;
};
