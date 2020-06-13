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
});
export const formatTrackListPayload = scTrackArr => scTrackArr.map(formatTrackPayload);
export const formatPlaylistPayload = scPlaylist => ({
  id: scPlaylist.id,
  title: scPlaylist.title,
  created_at: scPlaylist.created_at,
  duration: scPlaylist.duration,
  artwork_url: scPlaylist.artwork_url,
  track_count: scPlaylist.track_count,
  tracks: (scPlaylist || []).map(formatTrackListPayload),
  user: {
    id: scPlaylist.user.id,
    username: scPlaylist.user.username,
    permalink: scPlaylist.user.permalink,
    permalink_url: scPlaylist.user.permalink_url,
    avatar_url: scPlaylist.user.avatar_url,
  },
});
