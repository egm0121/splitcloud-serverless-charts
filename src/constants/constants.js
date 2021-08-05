const radioCountryCodes = require('./radio_country_codes').default;
const radioStations = require('./custom_stations').default;

const EU_COUNTRIES = [
  'BE',
  'EL',
  'LT',
  'PT',
  'BG',
  'ES',
  'LU',
  'RO',
  'CZ',
  'FR',
  'HU',
  'SI',
  'DK',
  'HR',
  'MT',
  'SK',
  'DE',
  'IT',
  'NL',
  'FI',
  'EE',
  'CY',
  'AT',
  'SE',
  'IE',
  'LV',
  'PL',
];
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
    // this is to avoid getting tracks present in older favorites
    MAX_RECENT_FAVORITES_TRACKS: 20, // DEPRECATED
    MAX_USER_SOURCE_TRACKS: 25, // how many of the user favorites to consider for home feed logic
    MAX_SOURCE_TRACKS: 25 + 5, // always use at least 5 tracks from splitcloud weekly popular chart
    MAX_RELATED_TRACKS: 30, // how many related tracks to use per each source track
    MIN_PLAYBACK_COUNT: 1000, // min number of plays needed for a track to be listed in the home feed
    MAX_TRACKS_PER_ALBUM: 3, // how many track per same artist/album to feature in the same feed
    SMART_FEED_COUNTRY: true, // disabled for perf testing of the feature ['US', 'EG', 'PK']
    FEED_SC_CHARTS_COUNTRY: ['US', 'UK', 'CA', 'MX', 'BR', 'AR', 'CO', 'NP', 'EC', 'PE'].concat(
      EU_COUNTRIES
    ),
  },
  DISABLE_SC: true, // controls if streaming from soundcloud is available
  ATHENA_SPLITCLOUD_WRAPPED_DATABASE: 'splitcloud_wrapped_db',
  WRAPPED_EVENT_TABLE_PREFIX: 'raw_playback_events_',
  WRAPPED_TOP_TRACKS_TABLE_PREFIX: 'plays_by_trackIdDeviceSide_',
  CTA: {
    REFERRAL_FEATURE_EXPIRY: '2024-01-01T23:59:00.000Z',
    GIVEAWAY_EXPIRY: '2020-08-31T23:59:00.000Z',
    USE_DDB_REFERRALS: true,
    SURVEY_PERCENT: 1, // 0.5
    SURVEY_EXPIRY: '2022-08-15T23:59:00.000Z', // 2021-08-15T23:59:00.000Z
    SURVEY_URL: 'http://www.splitcloud-app.com/scissue.html', // https://forms.gle/NkqG7mKuba5CXsoa6
    SURVEY_TEXT: 'Where are the songs?', // ✨ Give us your feedback ✨
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
    // IN: {
    //   ctaLabel: 'Remove ADS for 20₹ 🎉',
    //   ctaUrl: 'http://www.splitcloud-app.com/promo_IN_20.html',
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
