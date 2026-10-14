// Backblaze B2 (through its S3-compatible API; B2_KEY_ID + B2_APPLICATION_KEY) administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class BackblazeController extends ProviderController {
    constructor() {
        super('b2');
    }

    /** A time-limited link to a private file (what the native "download authorization" was for). */
    getDownloadAuthorization(bucketName: string, key: string, validSeconds = 3600, filename?: string): Promise<string> {
        return this.getPresignedUrl(bucketName, key, validSeconds, filename);
    }
}

export default new BackblazeController();
