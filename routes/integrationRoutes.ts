import { Router } from 'express';
import * as integrations from '../controllers/integrationController';
import { protect } from '../middleware/auth';
import { heavyLimiter } from '../middleware/rateLimits';
import { schemas, validate } from '../middleware/validation';

const router = Router();
router.use(protect);

router.get('/', integrations.getStatus);
router.get('/status', integrations.getStatus);

// outbound webhooks (signed, retried)
router.get('/webhooks', integrations.listWebhooks);
router.post('/webhooks', validate(schemas.webhookCreate), integrations.createWebhook);
router.patch('/webhooks/:id', validate(schemas.webhookUpdate), integrations.updateWebhook);
router.delete('/webhooks/:id', integrations.deleteWebhook);
router.post('/webhooks/:id/test', heavyLimiter, integrations.testWebhook);
router.post('/webhooks/:id/rotate-secret', integrations.rotateWebhookSecret);
router.get('/webhooks/:id/deliveries', integrations.webhookDeliveries);

// actions
router.post('/slack', heavyLimiter, validate(schemas.integrationSlack), integrations.slack);
router.post('/dropbox', heavyLimiter, validate(schemas.integrationDropbox), integrations.dropbox);
router.post('/google-drive', heavyLimiter, validate(schemas.integrationDrive), integrations.googleDrive);

// connections
router.put('/:type', validate(schemas.integrationConfig), integrations.configure);
router.delete('/:type', integrations.disconnect);

export default router;
