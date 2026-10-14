/**
 * Structured Logging Service for Cloud Storage Service.
 * Structured log entries with correlation ids and request/user context. The context lives in AsyncLocalStorage,
 * so concurrent requests never see each other's data. Entries are written through the winston logger.
 */
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import logger from '../../config/logger';

export interface LogContext {
    correlationId: string;
    method?: string;
    path?: string;
    userId?: string;
    [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

export class StructuredLoggingService {
    private fallback: LogContext | null = null;

    static createCorrelationId(): string {
        return crypto.randomUUID();
    }

    /** Outside a request this sets a process-wide default context; inside a request use `runWithContext`. */
    setContext(context: LogContext): void {
        const store = storage.getStore();
        if (store) Object.assign(store, context);
        else this.fallback = context;
    }

    getContext(): LogContext {
        return storage.getStore() ?? this.fallback ?? { correlationId: StructuredLoggingService.createCorrelationId() };
    }

    runWithContext<T>(context: LogContext, fn: () => T): T {
        return storage.run(context, fn);
    }

    logInformation(message: string, additionalContext?: Record<string, unknown>): void {
        logger.info(message, this.entry('Information', additionalContext));
    }

    logWarning(message: string, additionalContext?: Record<string, unknown>): void {
        logger.warn(message, this.entry('Warning', additionalContext));
    }

    logError(message: string, error?: unknown, additionalContext?: Record<string, unknown>): void {
        const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
        logger.error(message, { ...this.entry('Error', additionalContext), error: err });
    }

    logAuditEvent(eventType: string, description: string, additionalContext?: Record<string, unknown>): void {
        logger.info(`AUDIT: ${description}`, { ...this.entry('Audit', additionalContext), auditEventType: eventType, auditDescription: description });
    }

    private entry(level: string, additionalContext?: Record<string, unknown>): Record<string, unknown> {
        const ctx = this.getContext();
        return { level_name: level, requestId: ctx.correlationId, userId: ctx.userId, context: ctx, additionalContext };
    }
}

export const structuredLogger = new StructuredLoggingService();

/** Express middleware: accepts or creates `X-Request-Id` and opens the logging context for the request. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) && incoming) || StructuredLoggingService.createCorrelationId();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    storage.run({ correlationId: id, method: req.method, path: req.path }, next);
}

/** After authentication, so later lines carry who did it. */
export function setLogUser(userId: unknown): void {
    const store = storage.getStore();
    if (store) store.userId = String(userId);
}

export default StructuredLoggingService;
