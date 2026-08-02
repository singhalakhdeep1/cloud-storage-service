// Cloudflare R2 controller for cloud-storage-service

const AWS = require('aws-sdk');

class CloudflareR2Controller {
  constructor() {
    this.s3 = new AWS.S3({
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      region: 'auto',
    });
  }

  async uploadFile(bucketName, key, body, contentType) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      };
      await this.s3.upload(params).promise();
      return { success: true, message: 'File uploaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadFile(bucketName, key) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
      };
      const data = await this.s3.getObject(params).promise();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteFile(bucketName, key) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
      };
      await this.s3.deleteObject(params).promise();
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFiles(bucketName, prefix = '') {
    try {
      const params = {
        Bucket: bucketName,
        Prefix: prefix,
      };
      const data = await this.s3.listObjectsV2(params).promise();
      return { success: true, files: data.Contents };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createBucket(bucketName) {
    try {
      const params = {
        Bucket: bucketName,
      };
      await this.s3.createBucket(params).promise();
      return { success: true, message: 'Bucket created successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBucket(bucketName) {
    try {
      const params = {
        Bucket: bucketName,
      };
      await this.s3.deleteBucket(params).promise();
      return { success: true, message: 'Bucket deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getPresignedUrl(bucketName, key, expiry = 3600) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
        Expires: expiry,
      };
      const url = await this.s3.getSignedUrlPromise('getObject', params);
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async bucketExists(bucketName) {
    try {
      const params = {
        Bucket: bucketName,
      };
      await this.s3.headBucket(params).promise();
      return { success: true, exists: true };
    } catch (error) {
      if (error.statusCode === 404) {
        return { success: true, exists: false };
      }
      return { success: false, error: error.message };
    }
  }

  async listBuckets() {
    try {
      const data = await this.s3.listBuckets().promise();
      return { success: true, buckets: data.Buckets };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new CloudflareR2Controller();
