// DigitalOcean Spaces administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class DigitalOceanController extends ProviderController {
    constructor() {
        super('digitalocean');
    }
}

export default new DigitalOceanController();
