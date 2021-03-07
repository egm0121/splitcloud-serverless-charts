export const formatTrackPayload = scTrack => ({
  id: scTrack.id,
  title: scTrack.title,
  created_at: scTrack.created_at,
  duration: scTrack.duration,
  artwork_url: scTrack.artwork_url,
  genre: scTrack.genre,
  user: {
    id: scTrack.user.id,
    username: scTrack.user.username,
    permalink: scTrack.user.permalink,
    permalink_url: scTrack.user.permalink_url,
    avatar_url: scTrack.user.avatar_url,
  },
  stream_url: scTrack.stream_url,
  score: scTrack.score,
  baseScore: scTrack.baseScore,
  playback_count: scTrack.playback_count,
});
export const formatTrackListPayload = scTrackArr => scTrackArr.map(formatTrackPayload);
export const formatPlaylistPayload = scPlaylist => ({
  id: scPlaylist.id,
  title: scPlaylist.title,
  created_at: scPlaylist.created_at,
  duration: scPlaylist.duration,
  artwork_url: scPlaylist.artwork_url,
  track_count: scPlaylist.track_count,
  tracks: formatTrackListPayload(scPlaylist.tracks || []),
  user: {
    id: scPlaylist.user.id,
    username: scPlaylist.user.username,
    permalink: scPlaylist.user.permalink,
    permalink_url: scPlaylist.user.permalink_url,
    avatar_url: scPlaylist.user.avatar_url,
  },
});

export const formatRadioStationPayload = radioPayload => ({
  id: radioPayload.stationuuid,
  name: radioPayload.name,
  url: radioPayload.url,
  country: radioPayload.country,
  tags: radioPayload.tags,
  favicon: radioPayload.favicon,
  homepage: radioPayload.homepage,
  votes: radioPayload.votes,
});
export const formatRadioStationListPayload = radioArr => radioArr.map(formatRadioStationPayload);

export const createPlaylistFromTrackList = (
  tracks,
  title,
  userData = {
    permalink_url: 'https://soundcloud.com/splitcloud',
    permalink: 'splitcloud',
    username: 'SplitCloud',
    uri: 'https://api.soundcloud.com/users/596081820',
    id: 596081820,
    kind: 'user',
  }
) => ({
  id: null,
  user: userData,
  artwork: tracks[0].artwork_url,
  title,
  tracks,
});
