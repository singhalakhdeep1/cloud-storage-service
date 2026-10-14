// AWS S3 administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class AwsS3Controller extends ProviderController {
    constructor() {
        super('s3');
    }
}

export default new AwsS3Controller();
