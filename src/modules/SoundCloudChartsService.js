/* eslint-disable class-methods-use-this */
import axios from 'axios';
import cheerio from 'cheerio';
import cacheDecorator from 'egm0121-rn-common-lib/helpers/cacheDecorator';

const soundcloudkey = require('../../key/soundcloud_key.json');

const SC_API_ENDPOINT = 'api.soundcloud.com';
const SC_WEB_ENDPOINT = 'soundcloud.com';

async function resolveScTrackPermalink(trackPerma) {
  const trackUrl = `https://${SC_API_ENDPOINT}/resolve?client_id=${soundcloudkey.SC_CLIENT_ID}&url=${trackPerma}`;
  const resp = await axios({ method: 'GET', url: trackUrl, timeout: 1500 }).catch(() =>
    Promise.resolve({})
  );
  return resp.data;
}

async function fetchSoundCloudTrendingChart(scChartType, scCountry = 'all-countries') {
  const relatedUrl = `https://${SC_WEB_ENDPOINT}/charts/${scChartType}\?genre\=all-music\&country\=${scCountry}`;
  return axios({ method: 'GET', url: relatedUrl, timeout: 3000, responseType: 'text' });
}

async function fetchUserTracks(userId) {
  const trackUrl = `https://${SC_API_ENDPOINT}/users/${userId}/tracks?client_id=${soundcloudkey.SC_CLIENT_ID}`;
  const resp = await axios({ method: 'GET', url: trackUrl, timeout: 1500 }).catch(() =>
    Promise.resolve({})
  );
  return resp.data;
}

function filterStreambleTracks(item) {
  return !!item && item.streamable;
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
}
export default new SoundCloudChartsService();
