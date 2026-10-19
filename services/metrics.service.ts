/**
 * Prometheus metrics, served at GET /metrics: request latency, upload outcomes and sizes, virus detections,
 * downloads, cache hit rate and storage totals. Every instance exposes its own counters; Prometheus adds them up.
 */
import type { RequestHandler } from 'express';
import client from 'prom-client';
import cfg from '../config/env';
import { safeEqual } from '../utils/crypto';

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'cloud-storage' });
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
    registers: [registry],
});

const uploads = new client.Counter({
    name: 'cloudstorage_uploads_total',
    help: 'Uploads by outcome (stored / rejected) and reason',
    labelNames: ['result', 'reason'] as const,
    registers: [registry],
});

const uploadBytes = new client.Histogram({
    name: 'cloudstorage_upload_size_bytes',
    help: 'Size of stored uploads',
    labelNames: ['kind'] as const,
    buckets: [1024, 64 * 1024, 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024, 1024 * 1024 * 1024],
    registers: [registry],
});

const virus = new client.Counter({ name: 'cloudstorage_virus_detections_total', help: 'Uploads rejected because the scanner found malware', registers: [registry] });

const downloads = new client.Counter({ name: 'cloudstorage_downloads_total', help: 'Downloads by channel (api / share link)', labelNames: ['via'] as const, registers: [registry] });

const cacheLookups = new client.Counter({ name: 'cloudstorage_cache_lookups_total', help: 'Cache lookups by namespace and result', labelNames: ['namespace', 'result'] as const, registers: [registry] });

/* Storage totals are read from the database when Prometheus scrapes (at most every 30 s). */
let totals: { at: number; users: number; files: number; bytes: number } | null = null;
async function readTotals(): Promise<NonNullable<typeof totals>> {
    if (totals && Date.now() - totals.at < 30_000) return totals;
    const { default: User } = await import('../models/User');
    const { default: File } = await import('../models/File');
    const [agg, files] = await Promise.all([User.aggregate<{ users: number; bytes: number }>([{ $group: { _id: null, users: { $sum: 1 }, bytes: { $sum: '$storageUsed' } } }]), File.countDocuments({ deletedAt: null })]);
    totals = { at: Date.now(), users: agg[0]?.users ?? 0, bytes: agg[0]?.bytes ?? 0, files };
    return totals;
}
new client.Gauge({
    name: 'cloudstorage_storage_used_bytes',
    help: 'Bytes stored for all users (content, versions and variants)',
    registers: [registry],
    async collect() {
        this.set((await readTotals().catch(() => null))?.bytes ?? 0);
    },
});
new client.Gauge({
    name: 'cloudstorage_files',
    help: 'Files not in the trash',
    registers: [registry],
    async collect() {
        this.set((await readTotals().catch(() => null))?.files ?? 0);
    },
});
new client.Gauge({
    name: 'cloudstorage_users',
    help: 'Registered users',
    registers: [registry],
    async collect() {
        this.set((await readTotals().catch(() => null))?.users ?? 0);
    },
});

export const metrics = {
    uploadStored: (bytes: number, kind: 'file' | 'version') => {
        uploads.inc({ result: 'stored', reason: 'ok' });
        uploadBytes.observe({ kind }, bytes);
    },
    uploadRejected: (reason = 'error') => uploads.inc({ result: 'rejected', reason }),
    virusDetected: () => virus.inc(),
    download: (via: 'api' | 'link') => downloads.inc({ via }),
    cache: (namespace: string, hit: boolean) => cacheLookups.inc({ namespace, result: hit ? 'hit' : 'miss' }),
};

/** Times every request; the route label is the matched route pattern, never the raw URL (bounded cardinality). */
export const httpMetrics: RequestHandler = (req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
        const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : req.baseUrl || 'unmatched';
        end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
};

/** GET /metrics. With METRICS_TOKEN set, Prometheus must send it as a bearer token. */
export const metricsEndpoint: RequestHandler = async (req, res) => {
    if (cfg.METRICS_TOKEN) {
        const header = req.headers.authorization ?? '';
        if (!safeEqual(header, `Bearer ${cfg.METRICS_TOKEN}`)) {
            res.status(401).json({ success: false, message: 'Metrics token required' });
            return;
        }
    }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
};
