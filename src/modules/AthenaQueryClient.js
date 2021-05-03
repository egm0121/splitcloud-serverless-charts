import AWS from 'aws-sdk';
import AthenaExpress from 'athena-express';

AWS.config.update({ region: 'us-east-1' });

class AthenaQueryClient {
  constructor(config) {
    this.queryClient = new AthenaExpress({ ...AthenaQueryClient.defaults, ...config });
    this.execClient = new AthenaExpress({
      ...AthenaQueryClient.defaults,
      ...config,
      skipResults: true,
    });
  }

  async executeQuery(queryObj) {
    return this.execClient.query(queryObj);
  }

  async fetchQuery(queryObj) {
    return this.queryClient.query(queryObj);
  }
}
AthenaQueryClient.defaults = {
  aws: AWS,
  db: '',
  s3: 's3://com.splitcloud-app.app-sls/events/athena/',
};

export default AthenaQueryClient;
