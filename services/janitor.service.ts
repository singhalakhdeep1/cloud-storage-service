/**
 * Background housekeeping, so nothing is left behind and no space stays reserved forever:
 *   - upload sessions that ran out of time (chunks deleted, reserved quota returned)
 *   - direct uploads that were never confirmed
 *   - files past their expiry date, and files that stayed in the trash longer than TRASH_RETENTION_DAYS
 * One instance runs a pass at a time (a lock in Redis when it is available).
 */
import cfg from '../config/env';
import logger from '../config/logger';
import File from '../models/File';
import PendingUpload from '../models/PendingUpload';
import UploadSession from '../models/UploadSession';
import type { FileDoc, PendingUploadDoc, UploadSessionDoc } from '../types/models';
import { CacheService } from './cache/cache.service';
import * as direct from './direct.service';
import * as fileService from './file.service';
import * as upload from './upload.service';

const lock = new CacheService('janitor');
let timer: NodeJS.Timeout | null = null;
let running = false;

export interface JanitorReport {
    uploadSessions: number;
    pendingUploads: number;
    expiredFiles: number;
    trashPurged: number;
    errors: number;
}

/** One pass. `force` ignores the cross-instance lock (an administrator asked for it). */
export async function runOnce(options: { force?: boolean } = {}): Promise<JanitorReport> {
    const report: JanitorReport = { uploadSessions: 0, pendingUploads: 0, expiredFiles: 0, trashPurged: 0, errors: 0 };
    if (running) return report;
    running = true;
    const got = options.force || (await lock.setIfAbsent('run', String(process.pid), Math.max(30, cfg.JANITOR_INTERVAL_SECONDS)));
    if (!got) {
        running = false;
        return report;
    }
    const now = new Date();
    const guard = async (label: string, fn: () => Promise<void>): Promise<void> => {
        try {
            await fn();
        } catch (e) {
            report.errors++;
            logger.error(`janitor: ${label} failed`, { err: (e as Error).message });
        }
    };
    try {
        for (const s of (await UploadSession.find({ status: { $in: ['pending', 'uploading', 'paused'] }, expiresAt: { $lt: now } }).limit(200)) as UploadSessionDoc[]) {
            await guard('upload session', () => upload.expire(s));
            report.uploadSessions++;
        }
        for (const p of (await PendingUpload.find({ status: 'pending', expiresAt: { $lt: now } }).limit(200)) as PendingUploadDoc[]) {
            await guard('pending upload', () => direct.expire(p));
            report.pendingUploads++;
        }
        for (const f of (await File.find({ expiresAt: { $lt: now } }).limit(200)) as FileDoc[]) {
            await guard('expired file', () => fileService.purge(f));
            report.expiredFiles++;
        }
        if (cfg.TRASH_RETENTION_DAYS > 0) {
            const cutoff = new Date(Date.now() - cfg.TRASH_RETENTION_DAYS * 86_400_000);
            for (const f of (await File.find({ deletedAt: { $ne: null, $lt: cutoff } }).limit(200)) as FileDoc[]) {
                await guard('trash purge', () => fileService.purge(f));
                report.trashPurged++;
            }
        }
        if (report.uploadSessions + report.pendingUploads + report.expiredFiles + report.trashPurged) logger.info('janitor pass finished', { ...report });
    } finally {
        running = false;
    }
    return report;
}

export function start(): void {
    if (timer || !cfg.ENABLE_JANITOR) return;
    timer = setInterval(() => void runOnce().catch((e) => logger.error('janitor failed', { err: (e as Error).message })), cfg.JANITOR_INTERVAL_SECONDS * 1000);
    timer.unref();
    // the first pass shortly after boot, so a restart cleans up what a crash left behind
    setTimeout(() => void runOnce().catch(() => undefined), 5000).unref();
}

export function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
}
