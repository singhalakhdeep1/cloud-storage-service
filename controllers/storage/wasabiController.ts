// Wasabi administration. See ./base.ts for the operations.
import { ProviderController } from './base';

export class WasabiController extends ProviderController {
    constructor() {
        super('wasabi');
    }
}

export default new WasabiController();
