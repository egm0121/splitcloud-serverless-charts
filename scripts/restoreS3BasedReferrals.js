/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
const fs = require('fs').promises;
const path = require('path');
const { default: ReferralsRepo } = require('../src/repositories/Referrals');

const waitFor = ms => new Promise(res => setTimeout(res, ms));
export default async function restoreReferrals(
  dirPath = '/Users/gdellorbo/code/personal/splitcloud_ddb_migrate'
) {
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      const referralName = file.split('.')[0];
      const refereeList = JSON.parse(await fs.readFile(path.join(dirPath, file)));
      for (const referee of refereeList) {
        console.log(`assign to referrer: ${referralName} item: ${referee}`);
        await ReferralsRepo.insertReferreeForDevice(referralName, referee);
        await waitFor(1e3);
      }
    }
  } catch (err) {
    console.error(err);
  }
}
