import AthenaQueryClient from './AthenaQueryClient';
import chartsService from './chartsService';
import {
  ATHENA_SPLITCLOUD_WRAPPED_DATABASE,
  WRAPPED_TOP_TRACKS_TABLE_PREFIX,
} from '../constants/constants';

class WrappedPlaylistGenerator {
  constructor() {
    this.athena = new AthenaQueryClient({
      db: ATHENA_SPLITCLOUD_WRAPPED_DATABASE,
    });
  }

  async getWrappedForDeviceIdSideYear(deviceId, side, year) {
    const deviceWrappedQuery = `SELECT plays, song_id FROM ${ATHENA_SPLITCLOUD_WRAPPED_DATABASE}.${WRAPPED_TOP_TRACKS_TABLE_PREFIX}${year} WHERE device_id = '${deviceId}' AND device_side = 'side-${side}' ORDER BY plays DESC LIMIT 20`;
    const rawTrackIds = (await this.athena.fetchQuery(deviceWrappedQuery)).Items.map(item => ({
      id: item.song_id,
      splitcloud_total_plays: item.plays,
    }));
    return chartsService.hydrateScTrackObjects(rawTrackIds);
  }
}

export { WrappedPlaylistGenerator };

export default new WrappedPlaylistGenerator();
