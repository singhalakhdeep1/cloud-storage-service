// MinIO controller for cloud-storage-service

const Minio = require('minio');

class MinIOController {
  constructor() {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });
  }

  async uploadFile(bucketName, objectName, filePath, metaData = {}) {
    try {
      await this.minioClient.fPutObject(bucketName, objectName, filePath, metaData);
      return { success: true, message: 'File uploaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async uploadBuffer(bucketName, objectName, buffer, metaData = {}) {
    try {
      await this.minioClient.putObject(bucketName, objectName, buffer, metaData);
      return { success: true, message: 'Buffer uploaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadFile(bucketName, objectName, filePath) {
    try {
      await this.minioClient.fGetObject(bucketName, objectName, filePath);
      return { success: true, message: 'File downloaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getFile(bucketName, objectName) {
    try {
      const stream = await this.minioClient.getObject(bucketName, objectName);
      return { success: true, stream };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteFile(bucketName, objectName) {
    try {
      await this.minioClient.removeObject(bucketName, objectName);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFiles(bucketName, prefix = '', recursive = false) {
    try {
      const stream = this.minioClient.listObjects(bucketName, prefix, recursive);
      const files = [];
      await new Promise((resolve, reject) => {
        stream.on('data', (obj) => files.push(obj));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createBucket(bucketName) {
    try {
      await this.minioClient.makeBucket(bucketName);
      return { success: true, message: 'Bucket created successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteBucket(bucketName) {
    try {
      await this.minioClient.removeBucket(bucketName);
      return { success: true, message: 'Bucket deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getPresignedUrl(bucketName, objectName, expiry = 3600) {
    try {
      const url = await this.minioClient.presignedGetObject(bucketName, objectName, expiry);
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async bucketExists(bucketName) {
    try {
      const exists = await this.minioClient.bucketExists(bucketName);
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MinIOController();
