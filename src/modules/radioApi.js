import axios from 'axios';
import cacheDecorator from 'egm0121-rn-common-lib/helpers/cacheDecorator';

class RadioApi {
  constructor() {
    this.endpoint = 'https://de1.api.radio-browser.info/json';
    this.timeout = 5 * 1e3;
    this.getStationsByCountryCode = cacheDecorator.withCache(
      this.getStationsByCountryCode.bind(this),
      'getStationsByCountryCode',
      86400 * 1e3
    );
  }

  request(...args) {
    const requestObj = this.buildRequestObject(...[this.endpoint, ...args]);
    return axios(requestObj);
  }

  buildRequestObject(
    endpoint,
    route,
    params = {},
    method = RadioApi.methods.GET,
    cancelToken,
    timeout
  ) {
    const urlParams =
      method === RadioApi.methods.GET && Object.keys(params).length
        ? `?${this.toQueryString(params)}`
        : '';

    const reqObj = {
      method,
      url: `${endpoint}/${route}${urlParams}`,
      timeout: timeout || this.timeout,
      cancelToken,
    };
    if (method !== RadioApi.methods.GET) {
      reqObj.data = params;
    }
    return reqObj;
  }

  // eslint-disable-next-line class-methods-use-this
  toQueryString(paramObj) {
    return Object.keys(paramObj)
      .filter(key => paramObj[key] !== undefined)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(paramObj[key])}`)
      .join('&');
  }

  // eslint-disable-next-line class-methods-use-this
  extractCancelToken(opts) {
    const optsCopy = { ...opts };
    if (typeof opts !== 'object' || !('cancelToken' in opts)) {
      return [undefined, opts];
    }
    let cancelToken;
    if (typeof opts === 'object' && opts.cancelToken) {
      ({ cancelToken } = opts);
      delete optsCopy.cancelToken;
    }
    return [cancelToken, opts];
  }

  getStationsByCountryCode(opts) {
    const [cancelToken, queryOpts] = this.extractCancelToken(opts);
    return this.request(
      `stations/bycountrycodeexact/${opts.countryCode}`,
      { ...queryOpts },
      RadioApi.methods.GET,
      cancelToken
    );
  }

  getStationById(opts) {
    const [cancelToken, queryOpts] = this.extractCancelToken(opts);
    return this.request(
      `stations/byuuid/${opts.id}`,
      { ...queryOpts },
      RadioApi.methods.GET,
      cancelToken
    ).then(resp => resp.data[0]);
  }
}

RadioApi.methods = {
  GET: 'get',
  POST: 'post',
};
export default RadioApi;
