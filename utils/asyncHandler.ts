import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so rejected promises reach the error middleware. */
const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
    (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

export default asyncHandler;
