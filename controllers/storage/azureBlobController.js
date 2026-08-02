// Azure Blob Storage controller for cloud-storage-service

const { BlobServiceClient } = require('@azure/storage-blob');

class AzureBlobController {
  constructor() {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
  }

  async uploadFile(containerName, blobName, data, options = {}) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(data, options);
      return { success: true, message: 'Blob uploaded successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async downloadFile(containerName, blobName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const downloadBlockBlobResponse = await blockBlobClient.download();
      return { success: true, data: downloadBlockBlobResponse.readableStreamBody };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteFile(containerName, blobName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.delete();
      return { success: true, message: 'Blob deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listFiles(containerName, prefix = '') {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      let iter = containerClient.listBlobsFlat({ prefix });
      const blobs = [];
      for await (const blob of iter) {
        blobs.push(blob);
      }
      return { success: true, blobs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async createContainer(containerName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      await containerClient.create();
      return { success: true, message: 'Container created successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteContainer(containerName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      await containerClient.delete();
      return { success: true, message: 'Container deleted successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getBlobUrl(containerName, blobName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const url = blockBlobClient.url;
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async generateSasUrl(containerName, blobName, expiry = 3600) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const sasUrl = await blockBlobClient.generateSasUrl({
        expiresOn: new Date(new Date().valueOf() + expiry * 1000),
      });
      return { success: true, url: sasUrl };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async containerExists(containerName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      await containerClient.getProperties();
      return { success: true, exists: true };
    } catch (error) {
      if (error.statusCode === 404) {
        return { success: true, exists: false };
      }
      return { success: false, error: error.message };
    }
  }

  async listContainers() {
    try {
      let iter = this.blobServiceClient.listContainers();
      const containers = [];
      for await (const container of iter) {
        containers.push(container);
      }
      return { success: true, containers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AzureBlobController();
