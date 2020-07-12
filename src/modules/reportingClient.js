const { google } = require('googleapis');
const privatekey = require('../../key/splitcloud-lambda-04bda8c26386.json');

function generateAuthClient() {
  const jwtClient = new google.auth.JWT(privatekey.client_email, null, privatekey.private_key, [
    'https://www.googleapis.com/auth/analytics.readonly',
  ]);
  // authenticate request
  return jwtClient.authorize().then(resToken => {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: resToken.access_token,
    });
    return oauth2Client;
  });
}
async function initReportingClient(opts = {}) {
  const authClient = await generateAuthClient();
  return google.analyticsreporting(
    Object.assign(
      {},
      {
        version: 'v4',
        auth: authClient,
      },
      opts
    )
  );
}

module.exports = {
  initReportingClient,
};
