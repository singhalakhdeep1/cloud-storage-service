export interface FieldError {
    field: string;
    message: string;
}

/** An error the client is allowed to see: carries the HTTP status and, optionally, per-field messages. */
export class AppError extends Error {
    readonly status: 'fail' | 'error';
    readonly isOperational = true;

    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code?: string,
        public readonly errors?: FieldError[]
    ) {
        super(message);
        this.status = String(statusCode).startsWith('4') ? 'fail' : 'error';
        Error.captureStackTrace(this, this.constructor);
    }
}

export default AppError;
