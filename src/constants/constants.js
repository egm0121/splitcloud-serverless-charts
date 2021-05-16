const radioCountryCodes = require('./radio_country_codes').default;
const radioStations = require('./custom_stations').default;

module.exports = {
  TAGS_BLACKLIST: {
    '2020': true,
    scfirst: true,
    getmoreplays: true,
    top: true,
  },
  SONG_NAME_DELIMITERS: [
    '(',
    'prod ',
    'feat ',
    'feat.',
    'ft ',
    'ft.',
    'prod by',
    'prod by.',
    'x',
    '[',
  ],
  GENRE_CHARTS_BLACKLIST: {
    'Religion & Spirituality': true,
    Audiobooks: true,
    Business: true,
    Comedy: true,
    Entertainment: true,
    Learning: true,
    'News & Politics': true,
    Science: true,
    Sports: true,
    Storytelling: true,
    Technology: true,
    thunder: true,
    Ambient: true,
  },
  TITLE_CHARTS_BLACKLIST: ['asmr', 'relaxing', 'ambient', 'ambiance', 'type beat', 'instrumental'],
  EXPLORE_RELATED: {
    // how many of the most recent user favorites will be used to as user_input_tracks;
    // this is to avoid getting tracks related to older favorites
    MAX_RECENT_FAVORITES_TRACKS: 20,
    MAX_SOURCE_TRACKS: 10,
    MAX_USER_SOURCE_TRACKS: 10, // do not use the splitcloud charts tracks at all if user has enough favorites
    MAX_RELATED_TRACKS: 30,
    MIN_PLAYBACK_COUNT: 1000,
    MAX_TRACKS_PER_ALBUM: 3,
    SMART_FEED_COUNTRY: true, // disabled for perf testing of the feature ['US', 'EG', 'PK']
    FEED_SC_CHARTS_COUNTRY: ['US', 'UK', 'CA'],
  },
  ATHENA_SPLITCLOUD_WRAPPED_DATABASE: 'splitcloud_wrapped_db',
  WRAPPED_EVENT_TABLE_PREFIX: 'raw_playback_events_',
  WRAPPED_TOP_TRACKS_TABLE_PREFIX: 'plays_by_trackIdDeviceSide_',
  CTA: {
    REFERRAL_FEATURE_EXPIRY: '2022-03-01T23:59:00.000Z',
    GIVEAWAY_EXPIRY: '2020-08-31T23:59:00.000Z',
  },
  EMOJI_FLAGS: {
    US: '🇺🇸',
    IN: '🇮🇳',
    TH: '🇹🇭',
    PK: '🇵🇰',
    MX: '🇲🇽',
    DE: '🇩🇪',
    EG: '🇪🇬',
    PE: '🇵🇪',
  },
  IG_POST_COUNTRIES: ['US', 'IN', 'TH', 'PK', 'MX'],
  SC_SYSTEM_PLAYLIST_USER: {
    permalink_url: 'https://soundcloud.com/splitcloud',
    permalink: 'splitcloud',
    username: 'SplitCloud',
    uri: 'https://api.soundcloud.com/users/596081820',
    id: 596081820,
    kind: 'user',
  },
  DISCOVERY_COUNTRIES: {
    IN: 'India',
    PK: 'Pakistan',
    EG: 'Egypt',
    MX: 'Mexico',
    PE: 'Peru',
    TH: 'Thailand',
    DE: 'Germany',
    US: 'United States',
  },
  WRAPPED_YEAR_MONTH: [1], // what months to show the cta to compute personal top of year list -> this has to happen after computeWrappedAggregateTable runs.
  WRAPPED_COUNTRY_YEAR_MONTH: [], // what months to show per country top of the year - depreacted feature
  YEAR_WRAPPED_COUNTRIES: {}, // deprecated feature
  COUNTRY_PROMOTION: {
    // BR: {
    //   ctaUrl: 'http://www.splitcloud-app.com/promo_BR.html',
    // },
  },
  TOP_COUNTRIES: {
    IN: 'India',
    PK: 'Pakistan',
    MX: 'Mexico',
    MA: 'Morocco',
    DE: 'Germany',
    ID: 'Indonesia',
    DZ: 'Algeria',
    US: 'United States',
    EG: 'Egypt',
    TH: 'Thailand',
    IT: 'Italy',
    BR: 'Brazil',
    AR: 'Argentina',
    CO: 'Colombia',
    LK: 'Sri Lanka',
    NP: 'Nepal',
    SA: 'Saudi Arabia',
    FR: 'France',
    ES: 'Spain',
    PE: 'Peru',
    CL: 'Chile',
    AE: 'United Arab Emirates',
    IR: 'Iran',
    BD: 'Bangladesh',
    EC: 'Ecuador',
    GB: 'United Kingdom',
    RU: 'Russia',
  },
  SUPPORTED_UNICODE_SCRIPTS: [
    { name: 'latin', regexp: /\p{Script=Latin}/u },
    { name: 'arabic', regexp: /\p{Script=Arabic}/u },
    { name: 'armenian', regexp: /\p{Script=Armenian}/u },
    { name: 'cyrillic', regexp: /\p{Script=Cyrillic}/u },
    { name: 'greek', regexp: /\p{Script=Greek}/u },
    { name: 'thai', regexp: /\p{Script=Thai}/u },
    { name: 'han', regexp: /\p{Script=Han}/u },
  ],
  RADIO_COUNTRY_CODES: radioCountryCodes,
  STATIONS_CUSTOM: radioStations,
  STATIONS_BLACKLIST: {
    119353: true,
  },
};
