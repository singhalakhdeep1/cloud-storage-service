import type { ErrorRequestHandler, RequestHandler } from 'express';
import cfg from '../config/env';
import logger from '../config/logger';
import { ObjectNotFoundError } from '../services/storage/types';
import AppError, { type FieldError } from '../utils/appError';

/** Turns any thrown error into `{ success: false, message, error, code?, errors? }` without leaking internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
        // a stream already started: nothing sensible can be sent, close the connection
        res.destroy();
        return;
    }
    let status: number | undefined = err.statusCode || err.status;
    let message: string = err.message;
    let errors: FieldError[] | undefined;
    let code: string | undefined = err instanceof AppError ? err.code : undefined;

    if (err.name === 'CastError') {
        status = 404;
        message = 'Resource not found';
        code = 'not_found';
    } else if (err.code === 11000) {
        status = 409;
        message = 'That value is already in use';
        code = 'duplicate';
    } else if (err.name === 'ValidationError' && err.errors) {
        status = 400;
        errors = Object.entries(err.errors as Record<string, { message: string }>).map(([field, e]) => ({ field, message: e.message }));
        message = errors.map((e) => e.message).join(', ');
        code = 'validation';
    } else if (err.code === 'LIMIT_FILE_SIZE') {
        status = 413;
        message = 'File size exceeds the limit';
        code = 'too_large';
    } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FIELD_VALUE' || err.code === 'LIMIT_PART_COUNT') {
        status = 400;
        message = err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected field in file upload' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files' : 'Malformed upload';
        code = 'bad_upload';
    } else if (err.type === 'entity.parse.failed') {
        status = 400;
        message = 'Malformed JSON body';
    } else if (err.type === 'entity.too.large') {
        status = 413;
        message = 'Request body is too large';
    } else if (err instanceof ObjectNotFoundError) {
        status = 404;
        message = 'The stored file could not be found';
        code = 'object_missing';
    } else if (err instanceof RangeError && /range/i.test(err.message)) {
        status = 416;
        message = 'Requested range not satisfiable';
    } else if (err instanceof AppError && err.errors) {
        errors = err.errors;
    }

    if (typeof status !== 'number' || status < 400 || status > 599) status = 500;
    if (status >= 500) logger.error(`${req.method} ${req.originalUrl}: ${err.stack || err.message}`, { requestId: req.id });
    const shown = status >= 500 && cfg.isProd ? 'Internal server error' : message || 'Server Error';
    // `message` is what the web app and SDK display; `error` is kept for clients that read it
    res.status(status).json({ success: false, message: shown, error: shown, ...(code && { code }), ...(errors && { errors }), ...(req.id && { requestId: req.id }), ...(cfg.NODE_ENV === 'development' && status >= 500 && { stack: err.stack }) });
};

export const notFound: RequestHandler = (req, _res, next) => {
    next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'not_found'));
};

export default errorHandler;
