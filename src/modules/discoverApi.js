/* eslint-disable no-await-in-loop */
const axios = require('axios');
const scKey = require('../../key/soundcloud_key.json');
const helpers = require('./helpers');
const constants = require('../constants/constants');

const SC_API_ENDPOINT = 'http://api.soundcloud.com';

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
  const currMonth = new Date().getUTCMonth() + 1;
  let currYear = new Date().getUTCFullYear();
  if (![1, 12].includes(currMonth)) return [];
  if (currMonth === 1) currYear -= 1;
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
