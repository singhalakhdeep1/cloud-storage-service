// MinIO (S3-compatible, self-hosted) administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class MinIOController extends ProviderController {
    constructor() {
        super('minio');
    }
}

export default new MinIOController();
