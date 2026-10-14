// Google Cloud Storage administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class GCSController extends ProviderController {
    constructor() {
        super('gcs');
    }

    /** A V4 signed URL (the service account key must be configured). */
    getSignedUrl(bucketName: string, key: string, expiresIn = 3600, filename?: string): Promise<string> {
        return this.getPresignedUrl(bucketName, key, expiresIn, filename);
    }
}

export default new GCSController();
