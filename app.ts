import compression from 'compression';
import express, { type Express } from 'express';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import cfg from './config/env';
import logger from './config/logger';
import openApiSpec from './config/swagger';
import { redisHealthy } from './config/redis';
import errorHandler, { notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimits';
import { corsMiddleware, noStore, securityHeaders } from './middleware/security';
import adminRoutes from './routes/adminRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import authRoutes from './routes/authRoutes';
import contentRoutes from './routes/contentRoutes';
import fileRoutes from './routes/fileRoutes';
import imageRoutes from './routes/imageRoutes';
import integrationRoutes from './routes/integrationRoutes';
import localStorageRoutes from './routes/localStorageRoutes';
import sharedRoutes from './routes/sharedRoutes';
import storageRoutes from './routes/storageRoutes';
import uploadRoutes from './routes/uploadRoutes';
import { requestContext } from './services/structured-logging/structured-logging.service';
import { defaultProviderName, tryGetStorage } from './services/storage/registry';

export function createApp(): Express {
    const app = express();
    app.disable('x-powered-by');
    if (cfg.TRUST_PROXY) app.set('trust proxy', 1);

    app.use(requestContext);
    app.use(securityHeaders);
    app.use(corsMiddleware);
    app.use(compression());

    // one line per request, with timing
    app.use((req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
            if (req.path === '/health') return;
            logger.http(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`, { ms: Date.now() - started, ip: req.ip, requestId: req.id, userId: req.user ? String(req.user._id) : undefined });
        });
        next();
    });

    // signed local-storage URLs carry raw bodies: they are mounted before the JSON parser
    app.use('/api/storage/local', localStorageRoutes);

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    app.use('/api', apiLimiter);

    app.use('/api/auth', noStore, authRoutes);
    app.use('/api/files', fileRoutes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/images', imageRoutes);
    app.use('/api/analytics', analyticsRoutes);
    app.use('/api/integrations', integrationRoutes);
    app.use('/api/shared', noStore, sharedRoutes);
    app.use('/api/content', contentRoutes);
    app.use('/api/admin', noStore, adminRoutes);
    app.use('/api/storage', noStore, storageRoutes);

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Cloud Storage Service API' }));
    app.get('/openapi.json', (_req, res) => void res.json(openApiSpec));

    // liveness: is the process up. readiness: can it serve (database, storage, cache).
    app.get('/health', (_req, res) => {
        res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString() });
    });
    app.get('/health/ready', async (_req, res) => {
        const checks: Record<string, unknown> = { mongo: mongoose.connection.readyState === 1 };
        try {
            await tryGetStorage(defaultProviderName())?.ping();
            checks.storage = tryGetStorage(defaultProviderName()) ? { provider: defaultProviderName(), ok: true } : { provider: defaultProviderName(), ok: false, error: 'not configured' };
        } catch (e) {
            checks.storage = { provider: defaultProviderName(), ok: false, error: (e as Error).message };
        }
        checks.redis = await redisHealthy();
        const ok = checks.mongo === true && (checks.storage as { ok: boolean }).ok && checks.redis !== false;
        res.status(ok ? 200 : 503).json({ status: ok ? 'READY' : 'NOT_READY', checks, timestamp: new Date().toISOString() });
    });

    app.get('/api', (_req, res) => {
        res.status(200).json({
            name: 'Cloud Storage Service API',
            version: '2.0.0',
            description: 'Multi-provider file storage with resumable uploads, versions, sharing, image processing, virus scanning and encryption at rest',
            storageProvider: defaultProviderName(),
            endpoints: { auth: '/api/auth', files: '/api/files', upload: '/api/upload', images: '/api/images', analytics: '/api/analytics', integrations: '/api/integrations', shared: '/api/shared', admin: '/api/admin', storage: '/api/storage', docs: '/api-docs' },
        });
    });

    app.use(notFound);
    app.use(errorHandler);
    return app;
}

export default createApp;
