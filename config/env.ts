/**
 * Reads and validates the environment once. In production the service refuses to start with a missing or weak
 * secret instead of silently falling back to a guessable default.
 */
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const env = process.env;
const str = (name: string, def?: string): string | undefined => (env[name] !== undefined && env[name] !== '' ? env[name] : def);
const bool = (name: string, def: boolean): boolean => {
    const v = str(name);
    return v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const int = (name: string, def: number, min = 0): number => {
    const v = str(name);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number >= ${min}`);
    return Math.floor(n);
};
const csv = (name: string, def: string[] = []): string[] => {
    const v = str(name);
    return v === undefined ? def : v.split(',').map((s) => s.trim()).filter(Boolean);
};

const NODE_ENV = (str('NODE_ENV', 'development') as 'development' | 'test' | 'production');
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/** Types accepted for upload when ALLOWED_MIME_TYPES is not set. `*` allows everything (still scanned and served as attachment). */
export const DEFAULT_ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/markdown', 'application/json', 'application/zip',
    'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg',
];

function secret(name: string, minLength: number): string {
    const v = str(name);
    if (v && v.length >= minLength) return v;
    if (isProd) throw new Error(`${name} must be set to at least ${minLength} characters in production`);
    if (v) throw new Error(`${name} must be at least ${minLength} characters`);
    // development / test: a per-process random secret (tokens stop working on restart, which is the safe default)
    return crypto.randomBytes(minLength).toString('hex');
}

const PORT = int('PORT', 5000, 1);
const ENCRYPTION_KEY = str('ENCRYPTION_KEY');
if (ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes), e.g. `openssl rand -hex 32`');
if (!ENCRYPTION_KEY && isProd) throw new Error('ENCRYPTION_KEY must be set in production (64 hex characters): it protects integration tokens and webhook secrets');
const ENCRYPT_AT_REST = bool('ENCRYPT_AT_REST', false);
if (ENCRYPT_AT_REST && !ENCRYPTION_KEY) throw new Error('ENCRYPT_AT_REST needs ENCRYPTION_KEY');

const JWT_SECRET = secret('JWT_SECRET', 32);

const cfg = {
    NODE_ENV,
    isProd,
    isTest,
    PORT,
    MONGODB_URI: str('MONGODB_URI', 'mongodb://localhost:27017/file-upload-cloud') as string,
    LOG_LEVEL: str('LOG_LEVEL', 'info') as string,
    TRUST_PROXY: bool('TRUST_PROXY', false),

    /** Where browsers reach this API (used in signed local-storage URLs). */
    PUBLIC_URL: (str('PUBLIC_URL', `http://localhost:${PORT}`) as string).replace(/\/+$/, ''),
    /** Browser origins allowed by CORS. `*` is refused in production. */
    CLIENT_URL: csv('CLIENT_URL', ['http://localhost:3097']),

    REDIS_URL: str('REDIS_URL') ?? (str('REDIS_HOST') ? `redis://${str('REDIS_HOST')}:${int('REDIS_PORT', 6379, 1)}` : undefined),
    RATE_LIMIT_BUCKET_CAPACITY: int('RATE_LIMIT_BUCKET_CAPACITY', 100, 1),
    RATE_LIMIT_REFILL_RATE: Number(str('RATE_LIMIT_REFILL_RATE', '1')),

    JWT_SECRET,
    JWT_EXPIRE: str('JWT_EXPIRE', '7d') as string,
    ADMIN_EMAIL: str('ADMIN_EMAIL')?.toLowerCase(),
    ALLOW_REGISTRATION: bool('ALLOW_REGISTRATION', true),
    DEFAULT_STORAGE_LIMIT: int('DEFAULT_STORAGE_LIMIT', 5 * 1024 * 1024 * 1024, 1),

    /** AES-256-GCM key for encryption at rest and for integration tokens kept in the database. */
    ENCRYPTION_KEY,
    ENCRYPT_AT_REST,
    /** Signs download/upload URLs served by this API (local storage, encrypted files, share links). */
    URL_SIGNING_SECRET: str('URL_SIGNING_SECRET') ?? crypto.createHmac('sha256', JWT_SECRET).update('url-signing/v1').digest('hex'),

    /* ---- storage ---- */
    STORAGE_PROVIDER: str('STORAGE_PROVIDER') ?? str('CLOUD_PROVIDER', 'local') as string,
    LOCAL_STORAGE_PATH: path.resolve(str('LOCAL_STORAGE_PATH', 'uploads') as string),

    AWS_REGION: str('AWS_REGION', 'us-east-1') as string,
    AWS_S3_BUCKET: str('AWS_S3_BUCKET'),
    AWS_ACCESS_KEY_ID: str('AWS_ACCESS_KEY_ID'),
    AWS_SECRET_ACCESS_KEY: str('AWS_SECRET_ACCESS_KEY'),
    /** Only for S3-compatible stand-ins and tests; leave unset for AWS. */
    AWS_S3_ENDPOINT: str('AWS_S3_ENDPOINT'),
    AWS_S3_FORCE_PATH_STYLE: bool('AWS_S3_FORCE_PATH_STYLE', false),

    MINIO_ENDPOINT: str('MINIO_ENDPOINT'),
    MINIO_PORT: int('MINIO_PORT', 9000, 1),
    MINIO_USE_SSL: bool('MINIO_USE_SSL', false),
    MINIO_ACCESS_KEY: str('MINIO_ACCESS_KEY'),
    MINIO_SECRET_KEY: str('MINIO_SECRET_KEY'),
    MINIO_BUCKET: str('MINIO_BUCKET'),

    DO_ENDPOINT: str('DO_ENDPOINT'),
    DO_REGION: str('DO_REGION', 'nyc3') as string,
    DO_ACCESS_KEY_ID: str('DO_ACCESS_KEY_ID') ?? str('DIGITALOCEAN_SPACES_KEY'),
    DO_SECRET_ACCESS_KEY: str('DO_SECRET_ACCESS_KEY') ?? str('DIGITALOCEAN_SPACES_SECRET'),
    DO_BUCKET: str('DO_BUCKET'),

    WASABI_ENDPOINT: str('WASABI_ENDPOINT', 'https://s3.wasabisys.com') as string,
    WASABI_REGION: str('WASABI_REGION', 'us-east-1') as string,
    WASABI_ACCESS_KEY_ID: str('WASABI_ACCESS_KEY_ID'),
    WASABI_SECRET_ACCESS_KEY: str('WASABI_SECRET_ACCESS_KEY'),
    WASABI_BUCKET: str('WASABI_BUCKET'),

    R2_ACCOUNT_ID: str('R2_ACCOUNT_ID'),
    R2_ENDPOINT: str('R2_ENDPOINT'),
    R2_ACCESS_KEY_ID: str('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: str('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET: str('R2_BUCKET'),

    /** Backblaze B2 through its S3-compatible API. B2_KEY_ID is the application key id (B2_ACCOUNT_ID is accepted as an alias). */
    B2_ENDPOINT: str('B2_ENDPOINT'),
    B2_REGION: str('B2_REGION', 'us-west-004') as string,
    B2_KEY_ID: str('B2_KEY_ID') ?? str('B2_ACCOUNT_ID'),
    B2_APPLICATION_KEY: str('B2_APPLICATION_KEY'),
    B2_BUCKET: str('B2_BUCKET'),

    GCS_PROJECT_ID: str('GCS_PROJECT_ID'),
    GCS_KEY_FILENAME: str('GCS_KEY_FILENAME') ?? str('GCS_KEY_FILE'),
    GCS_BUCKET: str('GCS_BUCKET'),
    /** Only for emulators and tests. */
    GCS_API_ENDPOINT: str('GCS_API_ENDPOINT'),

    AZURE_STORAGE_CONNECTION_STRING: str('AZURE_STORAGE_CONNECTION_STRING'),
    AZURE_STORAGE_ACCOUNT: str('AZURE_STORAGE_ACCOUNT'),
    AZURE_STORAGE_KEY: str('AZURE_STORAGE_KEY'),
    AZURE_STORAGE_CONTAINER: str('AZURE_STORAGE_CONTAINER'),

    /* ---- uploads ---- */
    MAX_FILE_SIZE: int('MAX_FILE_SIZE', 100 * 1024 * 1024, 1),
    /** Largest chunk accepted by the resumable upload endpoint. */
    MAX_CHUNK_SIZE: int('MAX_CHUNK_SIZE', 10 * 1024 * 1024, 1024),
    ALLOWED_MIME_TYPES: csv('ALLOWED_MIME_TYPES', DEFAULT_ALLOWED_MIME_TYPES),
    ENABLE_IMAGE_PROCESSING: bool('ENABLE_IMAGE_PROCESSING', true),
    ENABLE_CHUNKED_UPLOAD: bool('ENABLE_CHUNKED_UPLOAD', true),
    MAX_FILE_VERSIONS: int('MAX_FILE_VERSIONS', 10, 1),
    TRASH_RETENTION_DAYS: int('TRASH_RETENTION_DAYS', 30, 0),
    UPLOAD_SESSION_TTL_HOURS: int('UPLOAD_SESSION_TTL_HOURS', 24, 1),
    JANITOR_INTERVAL_SECONDS: int('JANITOR_INTERVAL_SECONDS', 300, 5),
    ENABLE_JANITOR: bool('ENABLE_JANITOR', !isTest),

    ENABLE_VIRUS_SCAN: bool('ENABLE_VIRUS_SCAN', false),
    /** When the scanner is unreachable: false = reject the upload (safe), true = accept it unscanned. */
    VIRUS_SCAN_FAIL_OPEN: bool('VIRUS_SCAN_FAIL_OPEN', false),
    CLAMAV_HOST: str('CLAMAV_HOST', 'localhost') as string,
    CLAMAV_PORT: int('CLAMAV_PORT', 3310, 1),

    /* ---- CDN ---- */
    CDN_URL: str('CDN_URL')?.replace(/\/+$/, ''),
    CDN_PROVIDER: str('CDN_PROVIDER', 'cloudfront') as string,
    AWS_CLOUDFRONT_DISTRIBUTION: str('AWS_CLOUDFRONT_DISTRIBUTION'),
    CLOUDFLARE_API_KEY: str('CLOUDFLARE_API_KEY'),
    CLOUDFLARE_EMAIL: str('CLOUDFLARE_EMAIL'),
    CLOUDFLARE_ZONE_ID: str('CLOUDFLARE_ZONE_ID'),
    CLOUDFLARE_API_URL: (str('CLOUDFLARE_API_URL', 'https://api.cloudflare.com/client/v4') as string).replace(/\/+$/, ''),

    /* ---- integrations (endpoints can be overridden for tests) ---- */
    DROPBOX_UPLOAD_URL: str('DROPBOX_UPLOAD_URL', 'https://content.dropboxapi.com/2/files/upload') as string,
    GOOGLE_DRIVE_UPLOAD_URL: str('GOOGLE_DRIVE_UPLOAD_URL', 'https://www.googleapis.com/upload/drive/v3/files') as string,
    /** Allow webhook/Slack targets on private networks (local development and tests only). */
    WEBHOOK_ALLOW_PRIVATE: bool('WEBHOOK_ALLOW_PRIVATE', false),
    WEBHOOK_BACKOFF_MS: csv('WEBHOOK_BACKOFF_MS').map(Number).filter((n) => n > 0),
};

if (cfg.isProd) {
    if (cfg.CLIENT_URL.includes('*')) throw new Error('CLIENT_URL must list explicit origins in production (not "*")');
    if (cfg.WEBHOOK_ALLOW_PRIVATE) throw new Error('WEBHOOK_ALLOW_PRIVATE must not be enabled in production');
}

export type Config = typeof cfg;
export default cfg;
