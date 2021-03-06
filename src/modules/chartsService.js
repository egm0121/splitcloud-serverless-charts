/* eslint-disable class-methods-use-this */
const axios = require('axios');
const moment = require('moment');
const cacheDecorator = require('egm0121-rn-common-lib/helpers/cacheDecorator').default;
const soundcloudkey = require('../../key/soundcloud_key.json');
const GAReporting = require('./reportingClient');
const RadioApi = require('../modules/radioApi').default;
const constants = require('../constants/constants');

const SC_API_ENDPOINT = 'api.soundcloud.com';
const SC_V2_API_ENDPOINT = 'api-v2.soundcloud.com';
const MAX_TRACK_DURATION = 25 * 60 * 1000; // 20min
const radioApiInstance = new RadioApi();
async function fetchAnalyticsReport(
  limit,
  country,
  startDate = '7daysAgo',
  deviceId = false,
  category,
  eventAction = 'playback-completed',
  endDate = '0daysAgo'
) {
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
  };
  reportRequest.requestBody.reportRequests[0].dimensionFilterClauses = [];
  if (eventAction) {
    reportRequest.requestBody.reportRequests[0].dimensionFilterClauses.push({
      filters: [
        {
          dimensionName: 'ga:eventAction',
          operator: 'EXACT',
          expressions: [eventAction],
        },
      ],
    });
  }
  if (country) {
    reportRequest.requestBody.reportRequests[0].dimensionFilterClauses.push({
      filters: [
        {
          dimensionName: 'ga:country',
          operator: 'EXACT',
          expressions: [country],
        },
      ],
    });
  }
  if (deviceId) {
    reportRequest.requestBody.reportRequests[0].dimensionFilterClauses.push({
      filters: [
        {
          dimensionName: 'ga:dimension2',
          operator: 'EXACT',
          expressions: [deviceId],
        },
      ],
    });
    // if filtering by deviceId we only want to sort by totalEvents - since they all got generated from same client
    reportRequest.requestBody.reportRequests[0].orderBys = [
      { fieldName: 'ga:totalEvents', sortOrder: 'DESCENDING' },
    ];
    // if filtering by deviceId we only need totalEvents dimension
    reportRequest.requestBody.reportRequests[0].orderBys = [
      { fieldName: 'ga:totalEvents', sortOrder: 'DESCENDING' },
    ]
  }
  if (category) {
    reportRequest.requestBody.reportRequests[0].dimensionFilterClauses.push({
      filters: [
        {
          dimensionName: 'ga:eventCategory',
          operator: 'EXACT',
          expressions: [category],
        },
      ],
    });
  }
  const res = await reportingClient.reports.batchGet(reportRequest);
  return res;
}
async function fetchScTrackById(trackId, scApiToken = soundcloudkey.SC_CLIENT_ID) {
  const trackUrl = `http://${SC_API_ENDPOINT}/tracks/${trackId}?client_id=${scApiToken}`;
  return axios({ method: 'GET', url: trackUrl, timeout: 1500 });
}

async function fetchRelatedTracksById(trackId, scApiToken = soundcloudkey.SC_CLIENT_ID) {
  const relatedUrl = `http://${SC_API_ENDPOINT}/tracks/${trackId}/related?client_id=${scApiToken}`;
  return axios({ method: 'GET', url: relatedUrl, timeout: 1500 });
}

async function fetchSoundCloudTrendingChart(scApiToken = soundcloudkey.SC_CLIENT_ID) {
  const relatedUrl = `https://${SC_V2_API_ENDPOINT}/charts?limit=50&offset=0&streamable=true&kind=trending&genre=soundcloud:genres:all-music&client_id=${scApiToken}`;
  const chartData = await axios({ method: 'GET', url: relatedUrl, timeout: 1500 });
  return chartData.data.collection.map(item => item.track);
}
async function fetchRadioStationById(stationId) {
  return radioApiInstance.getStationById({ id: stationId });
}
async function hydrateRadioStations(stationList) {
  const finalTracks = {};
  return stationList
    .map(track => {
      const resolveTrack = Object.assign({}, track);
      resolveTrack.fetch = () =>
        fetchRadioStationById(track.id).catch(err => {
          console.warn(`radio track ${track.id} retrival failed`, err.message);
          return Promise.resolve();
        });
      return resolveTrack;
    })
    .reduce((prevPromise, nextTrackObj, idx, initList) => {
      const currTrackObj = initList[idx - 1];
      return prevPromise.then(stationData => {
        if (stationData) {
          finalTracks[currTrackObj.id] = { ...currTrackObj, ...stationData, fetch: undefined };
        }
        return nextTrackObj.fetch();
      });
    }, Promise.resolve())
    .then(() => Object.values(finalTracks));
}
async function hydrateSoundcloudTracks(trackList, scApiToken) {
  const finalTracks = {};
  return trackList
    .map(track => {
      const resolveTrack = Object.assign({}, track);
      resolveTrack.fetch = () =>
        fetchScTrackById(track.id, scApiToken).catch(err => {
          console.warn(`sc track ${track.id} retrival failed`, err.message);
          return Promise.resolve();
        });
      return resolveTrack;
    })
    .reduce((prevPromise, nextTrackObj, idx, initList) => {
      const currTrackObj = initList[idx - 1];
      return prevPromise.then(resp => {
        if (resp) {
          finalTracks[currTrackObj.id] = Object.assign({}, currTrackObj, resp.data);
        }
        return nextTrackObj.fetch();
      });
    }, Promise.resolve())
    .then(() => Object.values(finalTracks));
}
function extractResponseRows(response) {
  try {
    return response.data.reports[0].data.rows.map(row => {
      const [totalPlays, uniquePlays] = row.metrics[0].values;
      return {
        id: row.dimensions[0],
        splitcloud_total_plays: parseInt(totalPlays, 10),
        splitcloud_unique_plays: parseInt(uniquePlays, 10),
      };
    });
  } catch (err) {
    return [];
  }
}
function filterBySCValidId(item) {
  return !isNaN(parseInt(item.id, 10));
}
/**
 * Calculate the decay factor used for weekly trending score
 * @param {*} x days ago / 365
 */
function decayTimeFunc(x) {
  // this function gives highest possible value (1) to tracks published between 0 to 14 days ago (0.03),
  // then exponetially falls to 0 when days ago are getting near to 365 or more
  return Math.max(Math.min(1.2 * Math.pow(2, -7 * x), 1), 0.001);
}
function calulateBaseScore(item) {
  return Math.floor(item.splitcloud_unique_plays * 2 + Math.log(item.playback_count));
}
function calculateTrendingScore(item) {
  // double check this
  const daysDistance = moment().diff(moment(new Date(item.created_at)), 'days');
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
function sortByTotalPlays(rows) {
  return rows.sort((a, b) => b.splitcloud_total_plays - a.splitcloud_total_plays);
}
function sortByPopularityWithDecay(rows) {
  return rows.map(calculateTrendingScore).sort(byScore);
}
function filterMaxDuration(max) {
  return t => t.duration <= max;
}
function filterGenre(genreBlacklist) {
  return t => !(t.genre in genreBlacklist);
}
function filterTrackNameExclude(titleBlacklist) {
  return t => !titleBlacklist.filter(word => t.title.toLowerCase().indexOf(word) > -1).length;
}
class ChartsService {
  constructor() {
    this.getTopChart = cacheDecorator.withCache(
      this.getTopChart.bind(this),
      'get-top-chart',
      0,
      true
    );
  }

  getMostLikedChart(limit = 75, country = '') {
    return fetchAnalyticsReport(limit, country, '7daysAgo', false, false, 'ADD_PLAYLIST_ITEM')
      .then(extractResponseRows)
      .then(t => t.filter(filterBySCValidId))
      .then(hydrateSoundcloudTracks)
      .then(t => t.filter(filterMaxDuration(MAX_TRACK_DURATION)))
      .then(t => t.filter(filterGenre(constants.GENRE_CHARTS_BLACKLIST)))
      .then(t => t.filter(filterTrackNameExclude(constants.TITLE_CHARTS_BLACKLIST)))
      .then(sortByPopularity);
  }

  getTopChart(limit = 75, country = '', daysAgo) {
    return fetchAnalyticsReport(limit, country, daysAgo)
      .then(extractResponseRows)
      .then(t => t.filter(filterBySCValidId))
      .then(hydrateSoundcloudTracks)
      .then(t => t.filter(filterMaxDuration(MAX_TRACK_DURATION)))
      .then(t => t.filter(filterGenre(constants.GENRE_CHARTS_BLACKLIST)))
      .then(t => t.filter(filterTrackNameExclude(constants.TITLE_CHARTS_BLACKLIST)))
      .then(sortByPopularity)
      .then(chart => chart.slice(0, 50));
  }

  getTrendingChart(limit = 100, country = '') {
    return this.getTopChart(limit, country)
      .then(sortByPopularityWithDecay)
      .then(chart => chart.slice(0, 50));
  }

  getTopRadioStationsByCountry(limit = 75, country = '') {
    return fetchAnalyticsReport(
      limit,
      country,
      '30daysAgo',
      false,
      false,
      'radio-playback-completed'
    )
      .then(extractResponseRows)
      .then(list =>
        list
          .map(station => ({ ...station, id: station.id.replace('radiobrowser_', '') }))
          .filter(station => station.id.indexOf('-') > -1)
      )
      .then(hydrateRadioStations)
      .then(sortByTotalPlays);
  }

  getPopularTracksByDeviceId(limit = 10, startDate, deviceId, side) {
    const category = side ? `side-${side}` : null;
    return fetchAnalyticsReport(limit, null, startDate, deviceId, category)
      .then(extractResponseRows)
      .then(t => t.filter(filterBySCValidId))
      .then(t => hydrateSoundcloudTracks(t, soundcloudkey.BATCH_FETCHING_KEY))
      .then(t => t.filter(filterMaxDuration(MAX_TRACK_DURATION)))
      .then(sortByTotalPlays);
  }

  async getTopTrackForPeriod(limit, period, country, deviceId, category) {
    return fetchAnalyticsReport(
      limit,
      country,
      period.start,
      deviceId,
      category,
      'playback-completed',
      period.end
    )
      .then(extractResponseRows)
      .then(t => t.filter(filterBySCValidId))
      .catch(err => {
        console.error('getYearlyPopularTrack GA report failed for device: ', deviceId);
        console.error('GA error:', err.message);
        return [];
      });
  }

  async getYearlyPopularTrackByDimension(
    limit = 10,
    filterName,
    filterValue,
    side,
    includeLastPeriod = false
  ) {
    const currYear = new Date().getFullYear();
    const coupleOfMonths = [
      { start: `${currYear}-01-01`, end: `${currYear}-02-28` },
      { start: `${currYear}-03-01`, end: `${currYear}-04-30` },
      { start: `${currYear}-05-01`, end: `${currYear}-06-30` },
      { start: `${currYear}-07-01`, end: `${currYear}-08-31` },
      { start: `${currYear}-09-01`, end: `${currYear}-10-31` },
    ];
    if (includeLastPeriod) {
      coupleOfMonths.push({ start: `${currYear}-11-01`, end: `${currYear}-12-15` });
    }
    const category = side ? `side-${side}` : null;
    const allTracks = [];
    // eslint-disable-next-line no-restricted-syntax
    for (let period of coupleOfMonths) {
      let tracks = [];
      if (filterName === 'deviceId') {
        // eslint-disable-next-line no-await-in-loop
        tracks = await this.getTopTrackForPeriod(limit, period, undefined, filterValue, category);
      }
      if (filterName === 'country') {
        // eslint-disable-next-line no-await-in-loop
        tracks = await this.getTopTrackForPeriod(limit, period, filterValue);
      }
      allTracks.push(...tracks);
      console.log('got report', period);
    }
    const uniqueTracksMap = allTracks.reduce((map, currTrack) => {
      if (currTrack.id in map) {
        map[currTrack.id].splitcloud_total_plays += currTrack.splitcloud_total_plays;
      } else {
        map[currTrack.id] = currTrack;
      }
      return map;
    }, {});
    const unsortedList = Object.keys(uniqueTracksMap).map(trackId => uniqueTracksMap[trackId]);
    const sortedList = sortByTotalPlays([...unsortedList]).slice(0, limit);
    const hydratedList = await hydrateSoundcloudTracks(
      sortedList,
      soundcloudkey.BATCH_FETCHING_KEY
    );
    return sortByTotalPlays(hydratedList.filter(filterMaxDuration(MAX_TRACK_DURATION)));
  }

  async getYearlyPopularTrackByDeviceId(limit = 10, deviceId, side) {
    return this.getYearlyPopularTrackByDimension(limit, 'deviceId', deviceId, side);
  }

  async getYearlyPopularTrackByCountry(limit = 10, countryName) {
    return this.getYearlyPopularTrackByDimension(limit, 'country', countryName, undefined, true);
  }

  sortTrendingTracks(tracks) {
    return sortByPopularityWithDecay(tracks);
  }

  fetchRelatedTracksById(id) {
    return fetchRelatedTracksById(id);
  }

  fetchScTrackById(id) {
    return fetchScTrackById(id);
  }

  async fetchAllRelated(sourceTrackIds, maxRelatedTracks = Infinity) {
    const allRelatedReq = sourceTrackIds.map(trackId =>
      this.fetchRelatedTracksById(trackId).catch(() => ({ data: [] }))
    );
    const responsesArr = await Promise.all(allRelatedReq);
    // flatten all related tracks in one list
    return responsesArr.reduce((finalList, resp) => {
      const subsetRelated = resp.data.slice(0, maxRelatedTracks);
      finalList.push(...subsetRelated);
      return finalList;
    }, []);
  }

  async fetchScTrackList(trackList) {
    const trackProms = trackList.map(id => this.fetchScTrackById(id).catch(() => ({ data: {} })));
    const respArr = await Promise.all(trackProms);
    return respArr.map(resp => resp.data);
  }

  getScTrendingChart() {
    return fetchSoundCloudTrendingChart();
  }
}
module.exports = new ChartsService();
