/* eslint-disable no-use-before-define */
/* eslint-disable class-methods-use-this */
import axios from 'axios';
import cheerio from 'cheerio';
import cacheDecorator from 'egm0121-rn-common-lib/helpers/cacheDecorator';
import helpers from './helpers';

const soundcloudkey = require('../../key/soundcloud_key.json');

const SC_API_ENDPOINT = 'api.soundcloud.com';
const SC_WEB_ENDPOINT = 'soundcloud.com';
const ACTIVE_TOKEN_S3_PATH_V2 = 'app/app_config_v2.json';

async function resolveScTrackPermalink(trackPerma) {
  const trackUrl = `https://${SC_API_ENDPOINT}/resolve?url=${trackPerma}`;
  const resp = await axios({
    method: 'GET',
    url: trackUrl,
    timeout: 2500,
    headers: {
      Authorization: `OAuth ${SoundCloudApi.getScAccessToken()}`,
    },
  }).catch(() => Promise.resolve({}));
  return resp.data;
}

async function fetchSoundCloudTrendingChart(scChartType, scCountry = 'all-countries') {
  const relatedUrl = `https://${SC_WEB_ENDPOINT}/charts/${scChartType}?genre=all-music&country=${scCountry}`;
  return axios({ method: 'GET', url: relatedUrl, timeout: 3000, responseType: 'text' });
}

async function fetchUserTracks(userId) {
  const trackUrl = `https://${SC_API_ENDPOINT}/users/${userId}/tracks`;
  const resp = await axios({
    method: 'GET',
    url: trackUrl,
    timeout: 2500,
    headers: {
      Authorization: `OAuth ${SoundCloudApi.getScAccessToken()}`,
    },
  }).catch(() => Promise.resolve({}));
  return resp.data;
}

function filterStreambleTracks(item) {
  return !!item && item.streamable && item.access && item.access !== 'blocked';
}

class SoundCloudChartsService {
  constructor() {
    this.getLatestTracksForArtist = cacheDecorator.withCache(
      this.getLatestTracksForArtist.bind(this),
      'get-latest-chart',
      0,
      true
    );

    this.chartTypeMap = {
      trending: 'new',
      popular: 'top',
    };

    this.accessToken = '';
    this.refreshIntervalRef = false;
  }

  /**
   * fetch a valid access token from s3 since it is kept in sync by ActiveStreamToken service.
   * @returns {str} accessToken
   */
  async fetchScAccessToken(forceFetch) {
    if (this.refreshIntervalRef) clearInterval(this.refreshIntervalRef);
    this.refreshIntervalRef = setInterval(() => {
      console.log('refresh accessToken from s3');
      this.fetchScAccessToken(true);
    }, 60 * 1e3);
    if (this.accessToken && !forceFetch) {
      console.log('got accessToken', this.accessToken, 'from instance cache');
      return this.accessToken;
    }
    let response = '';
    try {
      response = await helpers.readJSONFromS3({
        keyName: ACTIVE_TOKEN_S3_PATH_V2,
        bucket: process.env.BUCKET,
        resolveExactPath: true,
      });
      if (response && response.STREAM_ACCESS_TOKEN) {
        this.accessToken = response.STREAM_ACCESS_TOKEN;
        console.log('got accessToken', this.accessToken, 'from s3 cache');
        return this.accessToken;
      }
    } catch (err) {
      console.error('fetchScAccessTokenError', err);
    }
    try {
      response = await axios({
        method: 'POST',
        url: 'https://api.soundcloud.com/oauth2/token',
        timeout: 2500,
        headers: {
          Accept: 'application/json; charset=utf-8',
          'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        data: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: soundcloudkey.SC_BK_CHARTS_CLIENT_ID,
          client_secret: soundcloudkey.SC_BK_CHARTS_CLIENT_SECRET,
        }),
      });
      this.accessToken = response.data.access_token;
      console.log('got accessToken', this.accessToken, 'from soundcloud oauth');
      return this.accessToken;
    } catch (err) {
      console.error(
        'fetchScAccessTokenError',
        err.response ? JSON.stringify(err.response.data.errors) : err
      );
    }
    return this.accessToken;
  }

  getScAccessToken() {
    if (!this.accessToken) throw new Error('No Access Token available');
    return this.accessToken;
  }

  async fetchChartsPermalinks(chartType = 'trending') {
    try {
      const chartSource = await fetchSoundCloudTrendingChart(this.chartTypeMap[chartType]);
      const wholePageDom = cheerio.load(chartSource.data);
      let noscriptContent = '';
      wholePageDom('noscript').each((i, el) => {
        noscriptContent += el.firstChild.data;
      });
      const $ = cheerio.load(`<div>${noscriptContent}</div>`);
      const trackPermaArr = [];
      $('ol li a[itemprop="url"]').each((idx, aEl) => {
        const songHref = aEl && aEl.attribs && aEl.attribs.href;
        trackPermaArr.push(`https://${SC_WEB_ENDPOINT}${songHref}`);
      });
      return trackPermaArr;
    } catch (err) {
      console.log('failed fetching permalinks for tracks', err);
      return [];
    }
  }

  async getChart(type) {
    await this.fetchScAccessToken();
    const permalinks = await this.fetchChartsPermalinks(type);
    const tracks = await Promise.all(permalinks.map(resolveScTrackPermalink));
    return tracks.filter(filterStreambleTracks);
  }

  async getTrendingChart() {
    return this.getChart('trending');
  }

  async getPopularChart() {
    return this.getChart('popular');
  }

  async getLatestTracksForArtist(artistId, limit = 2) {
    try {
      const allTracks = await fetchUserTracks(artistId);
      return allTracks.sort((ta, tb) => tb.created_at - ta.created_at).slice(0, limit);
    } catch (err) {
      return [];
    }
  }

  async fetchAllUserLatest(sourceUserIds) {
    await this.fetchScAccessToken();
    const uniqIds = [...new Set(sourceUserIds)];
    const allRelatedReq = uniqIds.map(trackId =>
      this.getLatestTracksForArtist(trackId).catch(() => [])
    );
    const responsesArr = await Promise.all(allRelatedReq);
    // flatten all related tracks in one list
    return responsesArr.reduce((finalList, currTrackList) => {
      finalList.push(...currTrackList);
      return finalList;
    }, []);
  }

  async resolveSCPlaylistById(scPlaylistId) {
    let payload;
    try {
      payload = await axios({
        method: 'GET',
        url: `${SC_API_ENDPOINT}/playlists/${scPlaylistId}/`,
        timeout: 5000,
        headers: {
          Authorization: `OAuth ${this.getScAccessToken()}`,
        },
      });
    } catch (err) {
      payload = null;
    }
    if (!payload) return null;
    const hasPlayableTracks = payload.data && payload.data.tracks.filter(t => t.streamable).length;
    if (!hasPlayableTracks) return null;
    delete payload.data.tracks;
    return payload.data;
  }
}
const SoundCloudApi = new SoundCloudChartsService();
export { SoundCloudChartsService };
export default SoundCloudApi;
