// Backblaze B2 controller for cloud-storage-service

const B2 = require('backblaze-b2');

class BackblazeController {
  constructor() {
    this.b2 = new B2({
      accountId: process.env.B2_ACCOUNT_ID,
      applicationKey: process.env.B2_APPLICATION_KEY,
    });
  }

  async authorize() {
    try {
      const authData = await this.b2.authorize();
      this.b2.setAuthData(authData);
      return { success: true, authData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async uploadFile(bucketId, fileName, data, contentType) {
    try {
      await this.authorize();
      const uploadUrl = await this.b2.getUploadUrl({
        bucketId,
      });
      const result = await this.b2.uploadFile({
        uploadUrl: uploadUrl.uploadUrl,
        uploadAuthToken: uploadUrl.authorizationToken,
        fileName,
        data,
        contentType,
      });
      return { success: true, fileId: result.fileId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadFile(fileId) {
    try {
      await this.authorize();
      const result = await this.b2.downloadFileById({
        fileId,
      });
      return { success: true, data: result.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteFile(fileId) {
    try {
      await this.authorize();
      await this.b2.deleteFileVersion({
        fileId,
        fileName: '',
      });
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFiles(bucketId, prefix = '') {
    try {
      await this.authorize();
      const result = await this.b2.listFileNames({
        bucketId,
        prefix,
        maxFileCount: 1000,
      });
      return { success: true, files: result.files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createBucket(bucketName) {
    try {
      await this.authorize();
      const result = await this.b2.createBucket({
        bucketName,
      });
      return { success: true, bucketId: result.bucketId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBucket(bucketId) {
    try {
      await this.authorize();
      await this.b2.deleteBucket({
        bucketId,
      });
      return { success: true, message: 'Bucket deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getDownloadUrl(fileId) {
    try {
      await this.authorize();
      const result = await this.b2.getDownloadAuthorization({
        fileId,
        validDurationInSeconds: 3600,
      });
      return { success: true, authorizationToken: result.authorizationToken };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listBuckets() {
    try {
      await this.authorize();
      const result = await this.b2.listBuckets();
      return { success: true, buckets: result.buckets };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new BackblazeController();
