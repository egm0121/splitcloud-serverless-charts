import axios from 'axios';
import ScreenshotConfig from './key/getScreenshots.json';
import helpers from './helpers';

class PostGenerator {
  constructor() {
    this.apiBase = 'https://api.rasterwise.com/v1';
  }

  getScreenshot(url, width, height) {
    const screenshotURL = `${this.apiBase}/get-screenshot?apikey=${
      ScreenshotConfig.API_KEY
    }&url=${encodeURIComponent(url)}&height=${height}&width=${width}`;
    console.log('getting screenshot from service', url);
    return axios({ method: 'GET', url: screenshotURL });
  }

  async fetchTrendingForCountry(countryCode) {
    const screenshotMeta = await this.getScreenshot(
      `http://www.splitcloud-app.com/trendingPost.html?region=${countryCode}`,
      1080,
      1350
    );
    console.log('got screenshot data', screenshotMeta.data);
    const scImagePath = screenshotMeta.data.screenshotImage;
    return axios({ method: 'GET', responseType: 'arraybuffer', url: scImagePath });
  }

  // eslint-disable-next-line class-methods-use-this
  async storeImageToS3(imageData, path) {
    console.log('store image at path', path);
    return helpers.saveBlobToS3(path, imageData, 'image/png');
  }

  async generateTrendingPostsForCountries(countryCodeArr) {
    const screenshotsPromises = countryCodeArr.map(countryCode =>
      this.fetchTrendingForCountry(countryCode).then(imageResp => {
        return this.storeImageToS3(imageResp.data, `posts/trending/coutry_${countryCode}.png`);
      })
    );
    return Promise.all(screenshotsPromises);
  }
}

export default PostGenerator;
