import http from 'http';
import mongoose from 'mongoose';
import { createApp } from './app';
import cfg from './config/env';
import logger from './config/logger';
import { closeRedis, initRedis } from './config/redis';
import * as janitor from './services/janitor.service';
import { configuredProviders, defaultProviderName, getStorage } from './services/storage/registry';
import * as webhooks from './services/webhook.service';
import virusScanner from './utils/virusScanner';

const app = createApp();

async function start(): Promise<http.Server> {
    await mongoose.connect(cfg.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    logger.info('MongoDB connected');
    await initRedis();

    // the default storage must work before we accept uploads
    const storage = getStorage(defaultProviderName());
    await storage.init?.();
    await storage.ping();
    logger.info(`Storage ready: ${storage.name}${storage.bucket ? ` (${storage.bucket})` : ''}; configured providers: ${configuredProviders().join(', ')}`);

    if (cfg.ENABLE_VIRUS_SCAN) {
        const healthy = await virusScanner.healthy();
        if (healthy) logger.info('ClamAV is reachable');
        else logger.warn(`ClamAV is not reachable at ${cfg.CLAMAV_HOST}:${cfg.CLAMAV_PORT}: uploads will be ${cfg.VIRUS_SCAN_FAIL_OPEN ? 'accepted unscanned' : 'rejected'} until it is`);
    }

    await webhooks.resumePending();
    janitor.start();

    const server = app.listen(cfg.PORT, () => {
        logger.info(`Cloud Storage Service listening on port ${cfg.PORT} (${cfg.NODE_ENV})`);
        logger.info(`API documentation: ${cfg.PUBLIC_URL}/api-docs`);
    });
    server.requestTimeout = 0; // large uploads can take a long time; the reverse proxy sets the real limits
    server.headersTimeout = 65_000;
    server.keepAliveTimeout = 61_000;

    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (closing) return;
        closing = true;
        logger.info(`${signal} received: shutting down`);
        janitor.stop();
        webhooks.stopTimers();
        const force = setTimeout(() => process.exit(1), 15_000);
        force.unref();
        server.close(async () => {
            await mongoose.disconnect().catch(() => undefined);
            await closeRedis();
            process.exit(0);
        });
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    return server;
}

// started only when run directly (`node dist/server.js`); tests and embedders just `require` the app
if (require.main === module) {
    start().catch((error) => {
        logger.error(`Failed to start: ${(error as Error).message}`);
        process.exit(1);
    });
}

export = app;
