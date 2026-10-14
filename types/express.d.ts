import type { FileDoc, UserDoc } from './models';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /** Correlation id (X-Request-Id), set by the logging middleware. */
            id?: string;
            /** The authenticated user (set by `protect` / `optionalAuth`). */
            user?: UserDoc;
            /** The token id of the access token that authenticated this request. */
            tokenId?: string;
            /** The file addressed by `:id`, loaded and access-checked by `loadFile`. (`req.file` belongs to multer.) */
            fileDoc?: FileDoc;
            /** The caller's access level on `fileDoc` (see access.service). */
            fileLevel?: number;
        }
    }
}

export {};
