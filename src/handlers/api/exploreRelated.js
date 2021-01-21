import SoundCloudChartsService from '../../modules/SoundCloudChartsService';

const chartService = require('../../modules/chartsService');
const helpers = require('../../modules/helpers');
const constants = require('../../constants/constants');
const formatters = require('../../modules/formatters');

const MIN_TRACK_DURATION = 30 * 1e3;

const getTrackTags = t => {
  const tagListText = t.tag_list || '';
  let separator = (tagListText.indexOf('"') > -1 && '"') || ' ';
  separator = (tagListText.indexOf(',') > -1 && ',') || separator;
  const rawTags = tagListText.split(separator).filter(tag => tag.length);
  rawTags.push(t.genre);
  rawTags.push(t.first_name, t.full_name, t.username);
  return rawTags
    .map(tag => tag && tag.trim().toLowerCase())
    .filter(tag => tag && tag.length > 1 && !(tag in constants.TAGS_BLACKLIST));
};

const roundToWeek = d => {
  d.setHours(0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() - 1));
  return d;
};
// sorts by week, rounds dates to closest preceeding monday
const sortByDateDay = (ta, tb) => {
  const dateB = roundToWeek(new Date(tb.created_at));
  const dateA = roundToWeek(new Date(ta.created_at));
  return dateB - dateA;
};
// extracts title only from the song, to de-duplicate diff version of same track
const extractSongNameFromTitle = track => {
  const allTitle = track.title.toLowerCase() || '';
  let trackName = allTitle;
  trackName = constants.SONG_NAME_DELIMITERS.reduce((currTrackName, delimiter) => {
    if (currTrackName.indexOf(delimiter)) return currTrackName.split(delimiter)[0];
    return currTrackName;
  }, trackName);
  return trackName.trim();
};

const logDev = (...args) => (helpers.isDEV ? console.log(...args) : null);
export default async (event, context, callback) => {
  // eslint-disable-next-line prefer-const
  let allInputTracks = JSON.parse(event.body) || [];
  context.metrics.setNamespace('splitcloud-exploreRelated');
  context.metrics.putMetric('inputFavTracks', allInputTracks.length);
  const recentInputTracks = allInputTracks.slice(
    0,
    constants.EXPLORE_RELATED.MAX_RECENT_FAVORITES_TRACKS
  );
  const userInputTracks = recentInputTracks.slice(
    0,
    constants.EXPLORE_RELATED.MAX_USER_SOURCE_TRACKS
  );
  const hasUserInputTracks = !!userInputTracks.length;
  let sourceTrackIds = [...userInputTracks];
  let clientCountry = (
    helpers.getQueryParam(event, 'region') ||
    event.headers['CloudFront-Viewer-Country'] ||
    'US'
  ).toUpperCase();

  const hasCountryPlaylist = Object.keys(constants.TOP_COUNTRIES).includes(clientCountry);
  if (!hasCountryPlaylist) clientCountry = 'GLOBAL';
  const playlistFilename = `charts/country/weekly_trending_country_${clientCountry}.json`;
  let trendingWeeklyPlaylist = [];
  try {
    trendingWeeklyPlaylist = await helpers.readJSONFromS3(playlistFilename);
  } catch (err) {
    console.error('weekly trending for country not avaiable', clientCountry);
  }
  const topTrackIds = trendingWeeklyPlaylist
    .slice(0, constants.EXPLORE_RELATED.MAX_SOURCE_TRACKS)
    .map(t => t.id);
  console.log(`fetching trending chart for country ${clientCountry}`);
  const fillNbr = constants.EXPLORE_RELATED.MAX_SOURCE_TRACKS - sourceTrackIds.length;
  console.log(
    `use ${sourceTrackIds.length} sourceTracks and ${fillNbr} charts track to generate lists`
  );
  sourceTrackIds = [...sourceTrackIds, ...topTrackIds.slice(0, fillNbr)];
  console.log('final source tracks', sourceTrackIds);
  const resolvedInputTracks = await chartService.fetchScTrackList(userInputTracks);
  // generate input tracks allowed tags
  const relatedTagsSet = new Set();
  resolvedInputTracks.forEach(track => getTrackTags(track).forEach(tag => relatedTagsSet.add(tag)));
  let relatedTrackList = [];
  // if user favorite tracks are provided, get the latest tracks for favorite artists
  if (hasUserInputTracks) {
    const sourceArtistIds = resolvedInputTracks.map(t => t && t.user && t.user.id);
    const newTracksByArtists = await SoundCloudChartsService.fetchAllUserLatest(sourceArtistIds);
    logDev(
      'got newTracksByArtists ',
      newTracksByArtists.map(t => `${t.title} - ${t.user.username} - ${t.genre} - ${t.streamable}`)
    );
    context.metrics.putMetric('newTracksByArtist', newTracksByArtists.length);
    relatedTrackList.push(...newTracksByArtists);
  }
  const allRelatedTracks = await chartService.fetchAllRelated(
    sourceTrackIds,
    constants.EXPLORE_RELATED.MAX_RELATED_TRACKS
  );
  relatedTrackList.push(...allRelatedTracks);
  const uniqueSet = new Set();
  // filter out any track included in the original input tracks
  relatedTrackList = relatedTrackList.filter(track => {
    if (track.playback_count < constants.EXPLORE_RELATED.MIN_PLAYBACK_COUNT) {
      logDev('excluded track min playback count:', track.title);
      return false;
    }
    if (uniqueSet.has(track.id)) {
      logDev('excluded track duplicate:', track.title);
      return false;
    }
    uniqueSet.add(track.id);
    if (allInputTracks.includes(track.id)) {
      logDev('excluded track already in user input:', track.title);
      return false;
    }
    if (track.duration <= MIN_TRACK_DURATION) {
      logDev('excluded track duration:', track.title);
      return false;
    }
    return true;
  });
  // add weekly soundcloud trending & popular tracks that match user favorites tags
  let recentSCTracks = [];
  try {
    const scChartsTracks = await Promise.all([
      helpers.readJSONFromS3(`charts/soundcloud/weekly_trending.json`),
      helpers.readJSONFromS3(`charts/soundcloud/weekly_popular.json`)
    ]);
    scChartsTracks.forEach(chartTracks => {
      recentSCTracks.push(...chartTracks);
    });
    recentSCTracks = recentSCTracks.filter(t => {
      // exclude duplicate tracks
      if (uniqueSet.has(t.id)) return false;
      // include all sc tracks if user does not have any prefered tags yet
      if (relatedTagsSet.size === 0) return true;
      const hasTagMatch = getTrackTags(t).find(scTag => relatedTagsSet.has(scTag));
      // if tags are matching and track is unique, add it to results
      if (hasTagMatch) {
        logDev(`adding SC track: ${t.title} because matched tag:`, hasTagMatch);
      }
      return hasTagMatch;
    });
    relatedTrackList.push(...recentSCTracks);
  } catch (err) {
    console.error(err, 'issue getting soundcloud charts tracks');
  }
  // filter all tracks by input unicode scripts
  const userTrackTitles = resolvedInputTracks.map(item => item.title).join(' ');
  console.log('source tracks titles', userTrackTitles);
  const allowedLangScripts = helpers.getStringScripts(userTrackTitles);
  console.log('allowedLangScripts', allowedLangScripts);
  relatedTrackList = relatedTrackList.filter(track => {
    if (!allowedLangScripts.length) return true;
    const currTrackScript = helpers.getStringScripts(track.title);
    if (currTrackScript.length === 0 && helpers.isStringNumeric(track.title)) return true;
    const isAllowed = helpers.arrayIntersect(allowedLangScripts, currTrackScript).length > 0;
    if (!isAllowed) logDev('excluding track for unicode script:', track.title);
    return isAllowed;
  });
  // add in any promoted tracks payload from s3
  let promotedScTracks;
  try {
    promotedScTracks = await helpers.readJSONFromS3(`app/suggested_tracklist.json`);
  } catch (err) {
    promotedScTracks = [];
  }
  if (Array.isArray(promotedScTracks)) {
    promotedScTracks.forEach(promoTrack => {
      if (
        relatedTagsSet.size === 0 ||
        getTrackTags(promoTrack).find(promoTag => relatedTagsSet.has(promoTag))
      ) {
        context.metrics.putMetric('includePromotedTrack', 1);
        context.metrics.putMetric(`track-${promoTrack.id}-promo-impression`, 1);
        relatedTrackList.push(promoTrack);
      }
    });
  }
  let nonPlayableTracksPerFeed = 0;
  // filter out all non third-party streamable tracks
  relatedTrackList = relatedTrackList.filter(track => {
    if (track.streamable) {
      return true;
    }
    logDev('exclude non streamable track:', track.label);
    // eslint-disable-next-line no-plusplus
    nonPlayableTracksPerFeed++;
    return false;
  });
  context.metrics.putMetric('nonStreambleTracksFilter', nonPlayableTracksPerFeed);
  const uniqSongTitle = new Set();
  // filter out repeated song names
  relatedTrackList = relatedTrackList.filter(t => {
    const songTitle = extractSongNameFromTitle(t);
    // exclude duplicate tracks
    if (uniqSongTitle.has(songTitle)) {
      context.metrics.putMetric('excludeDuplicateTrack', 1);
      logDev('exclude track: ', t.title, 'a song', songTitle, 'already exists');
      return false;
    }
    uniqSongTitle.add(songTitle);
    return true;
  });
  const trackPerUploader = {};
  // filter max suggested tracks x same album-artist key
  relatedTrackList = relatedTrackList.filter(t => {
    const trackUploader = t.user.username;
    if (!(trackUploader in trackPerUploader)) trackPerUploader[trackUploader] = 0;
    if (trackPerUploader[trackUploader] === constants.EXPLORE_RELATED.MAX_TRACKS_PER_ALBUM) {
      context.metrics.putMetric('excludeFromSameUser', 1);
      logDev('exclude by artist track', t.title, trackUploader);
      return false;
    }
    // eslint-disable-next-line no-plusplus
    trackPerUploader[trackUploader]++;
    return true;
  });
  // order all by recency
  relatedTrackList.sort(sortByDateDay);
  return callback(null, {
    statusCode: 200,
    headers: {
      ...context.headers,
    },
    body: JSON.stringify(formatters.formatTrackListPayload(relatedTrackList)),
  });
};
