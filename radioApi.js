import axios from 'axios';

class RadioApi {
  constructor() {
    this.endpoint = 'http://www.radio-browser.info/webservice/json';
    this.timeout = 5 * 1e3;
  }

  request(...args) {
    const requestObj = this.buildRequestObject(...[this.endpoint, ...args]);
    console.log('RadioBrowser api request object', requestObj);
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
    const urlParams = method === RadioApi.methods.GET && Object.keys(params).length
      ? `?${this.toQueryString(params)}` : '';

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
}

RadioApi.methods = {
  GET: 'get',
  POST: 'post',
};
export default RadioApi;