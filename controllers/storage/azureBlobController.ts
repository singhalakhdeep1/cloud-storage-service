// Azure Blob Storage (a "bucket" is a container) administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class AzureBlobController extends ProviderController {
    constructor() {
        super('azure');
    }

    /** The plain blob URL (works for public containers). */
    getBlobUrl(containerName: string, blobName: string): string {
        return this.provider.withBucket!(containerName).location(blobName);
    }

    /** A time-limited SAS URL for one blob. */
    getSasUrl(containerName: string, blobName: string, expiresIn = 3600, filename?: string): Promise<string> {
        return this.getPresignedUrl(containerName, blobName, expiresIn, filename);
    }
}

export default new AzureBlobController();
