import type { Request } from 'express';
import type { Types } from 'mongoose';
import logger from '../config/logger';
import FileActivity from '../models/FileActivity';

export type ActivityAction =
    | 'upload'
    | 'version'
    | 'version_restore'
    | 'download'
    | 'update'
    | 'trash'
    | 'restore'
    | 'share'
    | 'unshare'
    | 'link_create'
    | 'link_revoke'
    | 'link_download'
    | 'image_process'
    | 'integration_export';

/** Records who did what to a file. Never throws: activity is a log, not part of the operation. */
export function record(file: Types.ObjectId | string, actor: Types.ObjectId | string | undefined, action: ActivityAction, req?: Pick<Request, 'ip' | 'headers'>, details?: Record<string, unknown>): void {
    FileActivity.create({ file, actor, action, ip: req?.ip, userAgent: req?.headers?.['user-agent']?.toString().slice(0, 300), details }).catch((e: Error) => logger.warn('activity not recorded', { err: e.message }));
}
