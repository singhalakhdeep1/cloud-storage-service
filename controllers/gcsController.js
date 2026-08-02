// Google Cloud Storage controller for cloud-storage-service

const { Storage } = require('@google-cloud/storage');

class GCSController {
  constructor() {
    this.storage = new Storage({
      keyFilename: process.env.GCS_KEY_FILENAME,
      projectId: process.env.GCS_PROJECT_ID,
    });
  }

  async uploadFile(bucketName, fileName, data, options = {}) {
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(fileName);
      await file.save(data, options);
      return { success: true, message: 'File uploaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadFile(bucketName, fileName) {
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(fileName);
      const [data] = await file.download();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteFile(bucketName, fileName) {
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(fileName);
      await file.delete();
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFiles(bucketName, prefix = '') {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createBucket(bucketName) {
    try {
      await this.storage.createBucket(bucketName);
      return { success: true, message: 'Bucket created successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBucket(bucketName) {
    try {
      const bucket = this.storage.bucket(bucketName);
      await bucket.delete();
      return { success: true, message: 'Bucket deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getSignedUrl(bucketName, fileName, options = { action: 'read', expires: 3600 }) {
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(fileName);
      const [url] = await file.getSignedUrl(options);
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async bucketExists(bucketName) {
    try {
      const [exists] = await this.storage.bucket(bucketName).exists();
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listBuckets() {
    try {
      const [buckets] = await this.storage.getBuckets();
      return { success: true, buckets };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new GCSController();
