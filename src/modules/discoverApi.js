const axios = require('axios');
const scKey = require('../../key/soundcloud_key.json');
const helpers = require('./helpers');
const constants = require('../constants/constants');

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
async function getWrappedPlaylistFromChart(title, countryCode, year) {
  const tracks = await helpers.readJSONFromS3(
    `charts/wrapped_country/${year}/wrapped_${countryCode}.json`
  );
  return {
    id: null,
    user: constants.SC_SYSTEM_PLAYLIST_USER,
    artwork: tracks[0].artwork_url,
    title,
    tracks: tracks.slice(0, 10),
  };
}
async function getPlaylistFromChart(title, chartType, countryCode) {
  const tracks = await helpers.readJSONFromS3(
    `charts/country/weekly_${chartType.toLowerCase()}_country_${countryCode}.json`
  );
  return {
    id: null,
    user: constants.SC_SYSTEM_PLAYLIST_USER,
    artwork: tracks[0].artwork_url,
    title,
    tracks: tracks.slice(0, 10),
  };
}
async function generateSectionsForCountries(countriesList) {
  const returnArr = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const countryCode of Object.keys(countriesList)) {
    try {
      const countryName = countriesList[countryCode];
      console.log('generate section for ', countryCode, '-', countryName);
      const topPlaylist = await getPlaylistFromChart(`Top 10`, 'POPULAR', countryCode);
      const trendingPlaylist = await getPlaylistFromChart(`Trending`, 'TRENDING', countryCode);
      const countryFlag = constants.EMOJI_FLAGS[countryCode];
      returnArr.push({
        urn: `splitcloud:selections:countrychart:${countryCode}`,
        id: `splitcloud:selections:countrychart:${countryCode}`,
        title: `${countryFlag} ${countryName} Charts`,
        description: `The most listened in ${countryName}`,
        playlists: [topPlaylist, trendingPlaylist],
      });
    } catch (err) {
      console.error(`faile reading wrapped playlist for ${countryCode}`);
    }
  }
  return returnArr;
}
async function generateWrappedCountriesSection(countriesList) {
  const currYear = new Date().getFullYear();
  const returnArr = [
    {
      urn: `splitcloud:selections:wrappedcountrychart`,
      id: `splitcloud:selections:wrappedcountrychart`,
      title: `${currYear} Charts`,
      description: `The most listened tracks in ${currYear}`,
      playlists: [],
    },
  ];
  // eslint-disable-next-line no-restricted-syntax
  for (const countryCode of Object.keys(countriesList)) {
    const countryName = countriesList[countryCode];
    const countryFlag = constants.EMOJI_FLAGS[countryCode];
    try {
      // eslint-disable-next-line no-await-in-loop
      const topPlaylist = await getWrappedPlaylistFromChart(
        `${countryFlag} ${countryName}`,
        countryCode,
        currYear
      );
      console.log('push wrapped for ', countryName);
      returnArr[0].playlists.push(topPlaylist);
    } catch (err) {
      console.error(`failed reading wrapped playlist for ${countryName}`, err.message);
    }
  }
  return returnArr;
}
module.exports = async function discoverApi(eventData) {
  if (eventData && !validateEventData(eventData)) {
    throw new Error('Event Data did not pass validation');
  }

  const apiResponse = {
    collection: [],
  };
  const allSectionsResolved = eventData
    ? await Promise.all(
        eventData.map(item =>
          generateDicoverySection(item.sectionName, item.sectionDescription, item.playlists)
        )
      )
    : [];
  const discoveryCountries = constants.DISCOVERY_COUNTRIES;
  const regionalTopSections = await generateSectionsForCountries(discoveryCountries);
  const regionalWrappedSection = await generateWrappedCountriesSection(
    constants.YEAR_WRAPPED_COUNTRIES
  );
  apiResponse.collection = [
    ...regionalWrappedSection,
    ...allSectionsResolved,
    ...regionalTopSections,
  ];
  console.log('allSectionsResolved', allSectionsResolved);
  if (process.env.BUCKET) {
    const s3Path = 'app/api/discovery.json';
    console.log('updated discovery api at path', s3Path);
    return helpers.saveFileToS3(s3Path, apiResponse);
  }
  return apiResponse;
};
