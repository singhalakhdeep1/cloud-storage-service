// Cloudflare R2 administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class CloudflareR2Controller extends ProviderController {
    constructor() {
        super('r2');
    }
}

export default new CloudflareR2Controller();
