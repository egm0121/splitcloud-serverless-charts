/* eslint-disable class-methods-use-this */
const helpers = require('../modules/helpers');

const { DYNAMODB_TABLE } = process.env;

const waitFor = ms => new Promise(res => setTimeout(res, ms));
/**
 * Dynamo Table structure
 * | pk | sk | attrs
 * |
 */

class Referrals {
  constructor({ tableName, ddbClient } = {}) {
    this.tableName = tableName || 'splitcloud-serverless-charts-service-dev-db';
    this.client = ddbClient;
  }

  toSecTimestamp(milliTs) {
    return parseInt(milliTs / 1000, 10);
  }

  async batchInsertPromocodes(promocodesList, lastModDate, uploadDate = Date.now(), expireDate) {
    // eslint-disable-next-line no-param-reassign
    expireDate = expireDate || Date.now() + 86400 * 365 * 1e3;

    const params = {
      TableName: this.tableName,
      ConditionExpression: 'attribute_not_exists(pk)',
      Item: {
        pk: Referrals.KEY.LAST_PROMOCODES_UPDATE,
        sk: lastModDate,
        updatedAt: uploadDate,
      },
    };
    try {
      // make sure that the unique version of codes is not already existing
      await this.client.put(params).promise();
    } catch (err) {
      console.log('promocodes batch version failed');
      return false;
    }
    // eslint-disable-next-line arrow-body-style
    const allProm = promocodesList.map(code => {
      return this.client
        .put({
          TableName: this.tableName,
          Item: {
            pk: Referrals.KEY.CODE_UNASSIGNED,
            sk: code,
            createdAt: uploadDate,
            expireAt: this.toSecTimestamp(expireDate),
          },
        })
        .promise();
    });
    return Promise.all(allProm);
  }

  async insertPromocode(promocode, uploadDate = Date.now(), expireDate) {
    // eslint-disable-next-line no-param-reassign
    expireDate = expireDate || Date.now() + 86400 * 365 * 1e3;
    const params = {
      TableName: this.tableName,
      Item: {
        pk: Referrals.KEY.CODE_UNASSIGNED,
        sk: promocode,
        createdAt: uploadDate,
        expireAt: this.toSecTimestamp(expireDate),
      },
    };
    // insert the new Referee to the list
    return this.client.put(params).promise();
  }

  async insertReferreeForDevice(referrerId, refereeDeviceId) {
    const createdAt = new Date().getTime();
    const params = {
      TableName: this.tableName,
      Item: {
        pk: `${Referrals.PREFIX.DEVICE_REF_BY}${referrerId}`,
        sk: refereeDeviceId,
        createdAt,
      },
    };
    // insert the new Referee to the list
    return this.client.put(params).promise();
  }

  async getAllReferreesForDevice(referrerId, limit = 10) {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk ',
      ExpressionAttributeValues: {
        ':pk': `${Referrals.PREFIX.DEVICE_REF_BY}${referrerId}`,
      },
      Limit: limit,
    };
    const result = await this.client.query(params).promise();
    return result.Items.map(raw => ({ refereeId: raw.sk, createdAt: raw.createdAt }));
  }

  async getUnassignedPromocode() {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': Referrals.KEY.CODE_UNASSIGNED,
      },
      Limit: 1,
    };
    const result = await this.client.query(params).promise();
    return result.Items[0];
  }
  /**
   * This will return the total unassigned promocodes left
   * It will return partial count if more than 1MB of matching items are found
   */

  async getUnassignedPromocodesCount() {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': Referrals.KEY.CODE_UNASSIGNED,
      },
      ProjectionExpression: 'pk',
    };
    const result = await this.client.query(params).promise();
    return result.Count;
  }

  async assignPromocodeToDevice(referrerId, attempt = 2) {
    const existingPromocode = await this.getPromocodeForDevice(referrerId);
    if (existingPromocode) {
      console.warn('promocode exists for ', referrerId);
      return existingPromocode;
    }
    let unassignedPromocode;
    try {
      // grab one unassigned promocode
      unassignedPromocode = await this.getUnassignedPromocode();
    } catch (err) {
      console.error('Error selecting assignment for promocode');
      throw new Error(err);
    }
    const updatedAt = new Date().getTime();
    try {
      await this.client
        .delete({
          TableName: this.tableName,
          Key: {
            pk: unassignedPromocode.pk,
            sk: unassignedPromocode.sk,
          },
          ConditionExpression: 'attribute_exists(pk)',
        })
        .promise();
    } catch (err) {
      console.error(err);
      if (attempt > 0) {
        console.log(
          `promocode assign failed for ${referrerId} with code ${
            unassignedPromocode.sk
          }, retrying...`
        );
        // in case of confict wait and retry to assign a new promocode
        await waitFor(500);
        return this.assignPromocodeToDevice(referrerId, attempt - 1);
      }
      throw err;
    }
    console.log('creating an assignment record');
    const params = {
      TableName: this.tableName,
      Item: {
        pk: Referrals.KEY.CODE_ASSIGNED,
        sk: referrerId,
        code: unassignedPromocode.sk,
        updatedAt,
      },
    };
    console.log('update record', params);
    return this.client.put(params).promise();
  }

  async forcefullyAssignPromocodeToDevice(referrerId, promoCode) {
    const updatedAt = new Date().getTime();
    const params = {
      TableName: this.tableName,
      Item: {
        pk: Referrals.KEY.CODE_ASSIGNED,
        sk: referrerId,
        code: promoCode,
        updatedAt,
        isForced: true,
      },
    };
    console.log('update record', params);
    return this.client.put(params).promise();
  }

  async getPromocodeForDevice(referrerId) {
    const params = {
      TableName: this.tableName,
      Key: {
        pk: Referrals.KEY.CODE_ASSIGNED,
        sk: referrerId,
      },
    };
    console.log(params);
    const resp = await this.client.get(params).promise();
    return resp && resp.Item && resp.Item.code;
  }
}
Referrals.KEY = {};
Referrals.KEY.CODE_UNASSIGNED = 'Promocode#Unassigned';
Referrals.KEY.CODE_ASSIGNED = 'Promocode#Assigned';
Referrals.KEY.LAST_PROMOCODES_UPDATE = 'Promocode#lastListUpdate';
Referrals.PREFIX = {};
Referrals.PREFIX.DEVICE_REF_BY = 'DeviceRefList#';

export default new Referrals({ tableName: DYNAMODB_TABLE, ddbClient: helpers.ddb });
