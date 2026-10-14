/**
 * Which storage providers are configured, and the instance for each. Providers are built on first use from the
 * environment, so an unused provider needs no configuration at all.
 */
import cfg from '../../config/env';
import AppError from '../../utils/appError';
import { PROVIDER_NAMES, type ProviderName } from '../../types/models';
import { LocalProvider } from './local.provider';
import type { StorageProvider } from './types';

// The cloud SDKs are large; each is loaded the first time its provider is used, so a deployment that only uses
// local disk or S3 never pays for the Azure and Google libraries (start-up time and memory).
const s3 = () => (require('./s3.provider') as typeof import('./s3.provider')).S3Provider;
const gcsProvider = () => (require('./gcs.provider') as typeof import('./gcs.provider')).GcsProvider;
const azureProvider = () => (require('./azure.provider') as typeof import('./azure.provider')).AzureProvider;

const ALIASES: Record<string, ProviderName> = {
    aws: 's3',
    amazon: 's3',
    spaces: 'digitalocean',
    do: 'digitalocean',
    cloudflare: 'r2',
    backblaze: 'b2',
    google: 'gcs',
    blob: 'azure',
};

export function normalizeProviderName(raw: string | undefined | null): ProviderName | undefined {
    if (!raw) return undefined;
    const v = raw.trim().toLowerCase();
    const name = ALIASES[v] ?? v;
    return (PROVIDER_NAMES as readonly string[]).includes(name) ? (name as ProviderName) : undefined;
}

type Builder = () => StorageProvider | null;

const publicEndpoint = (prefix: string): string | undefined => process.env[`${prefix}_PUBLIC_ENDPOINT`] || undefined;

const builders: Record<ProviderName, Builder> = {
    local: () => new LocalProvider(),
    s3: () =>
        cfg.AWS_S3_BUCKET
            ? new (s3())('s3', {
                  bucket: cfg.AWS_S3_BUCKET,
                  region: cfg.AWS_REGION,
                  endpoint: cfg.AWS_S3_ENDPOINT,
                  publicEndpoint: publicEndpoint('AWS_S3'),
                  accessKeyId: cfg.AWS_ACCESS_KEY_ID,
                  secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
                  forcePathStyle: cfg.AWS_S3_FORCE_PATH_STYLE,
              })
            : null,
    minio: () =>
        cfg.MINIO_ENDPOINT && cfg.MINIO_ACCESS_KEY && cfg.MINIO_SECRET_KEY
            ? new (s3())('minio', {
                  bucket: cfg.MINIO_BUCKET ?? 'files',
                  region: 'us-east-1',
                  endpoint: /^https?:\/\//.test(cfg.MINIO_ENDPOINT) ? cfg.MINIO_ENDPOINT : `${cfg.MINIO_USE_SSL ? 'https' : 'http'}://${cfg.MINIO_ENDPOINT}:${cfg.MINIO_PORT}`,
                  publicEndpoint: publicEndpoint('MINIO'),
                  accessKeyId: cfg.MINIO_ACCESS_KEY,
                  secretAccessKey: cfg.MINIO_SECRET_KEY,
                  forcePathStyle: true,
              })
            : null,
    digitalocean: () =>
        cfg.DO_BUCKET && cfg.DO_ACCESS_KEY_ID && cfg.DO_SECRET_ACCESS_KEY
            ? new (s3())('digitalocean', {
                  bucket: cfg.DO_BUCKET,
                  region: cfg.DO_REGION,
                  endpoint: cfg.DO_ENDPOINT ?? `https://${cfg.DO_REGION}.digitaloceanspaces.com`,
                  publicEndpoint: publicEndpoint('DO'),
                  accessKeyId: cfg.DO_ACCESS_KEY_ID,
                  secretAccessKey: cfg.DO_SECRET_ACCESS_KEY,
                  forcePathStyle: true,
              })
            : null,
    wasabi: () =>
        cfg.WASABI_BUCKET && cfg.WASABI_ACCESS_KEY_ID && cfg.WASABI_SECRET_ACCESS_KEY
            ? new (s3())('wasabi', {
                  bucket: cfg.WASABI_BUCKET,
                  region: cfg.WASABI_REGION,
                  endpoint: cfg.WASABI_ENDPOINT,
                  publicEndpoint: publicEndpoint('WASABI'),
                  accessKeyId: cfg.WASABI_ACCESS_KEY_ID,
                  secretAccessKey: cfg.WASABI_SECRET_ACCESS_KEY,
                  forcePathStyle: true,
              })
            : null,
    r2: () =>
        cfg.R2_BUCKET && cfg.R2_ACCESS_KEY_ID && cfg.R2_SECRET_ACCESS_KEY && (cfg.R2_ENDPOINT || cfg.R2_ACCOUNT_ID)
            ? new (s3())('r2', {
                  bucket: cfg.R2_BUCKET,
                  region: 'auto',
                  endpoint: cfg.R2_ENDPOINT ?? `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                  publicEndpoint: publicEndpoint('R2'),
                  accessKeyId: cfg.R2_ACCESS_KEY_ID,
                  secretAccessKey: cfg.R2_SECRET_ACCESS_KEY,
                  forcePathStyle: true,
              })
            : null,
    b2: () =>
        cfg.B2_BUCKET && cfg.B2_KEY_ID && cfg.B2_APPLICATION_KEY
            ? new (s3())('b2', {
                  bucket: cfg.B2_BUCKET,
                  region: cfg.B2_REGION,
                  endpoint: cfg.B2_ENDPOINT ?? `https://s3.${cfg.B2_REGION}.backblazeb2.com`,
                  publicEndpoint: publicEndpoint('B2'),
                  accessKeyId: cfg.B2_KEY_ID,
                  secretAccessKey: cfg.B2_APPLICATION_KEY,
                  forcePathStyle: true,
              })
            : null,
    gcs: () => (cfg.GCS_BUCKET ? new (gcsProvider())({ bucket: cfg.GCS_BUCKET, projectId: cfg.GCS_PROJECT_ID, keyFilename: cfg.GCS_KEY_FILENAME, apiEndpoint: cfg.GCS_API_ENDPOINT }) : null),
    azure: () => {
        if (!cfg.AZURE_STORAGE_CONNECTION_STRING && !(cfg.AZURE_STORAGE_ACCOUNT && cfg.AZURE_STORAGE_KEY)) return null;
        return new (azureProvider())({ container: cfg.AZURE_STORAGE_CONTAINER ?? 'files', connectionString: cfg.AZURE_STORAGE_CONNECTION_STRING, accountName: cfg.AZURE_STORAGE_ACCOUNT, accountKey: cfg.AZURE_STORAGE_KEY });
    },
};

const instances = new Map<ProviderName, StorageProvider>();
const override = new Map<ProviderName, StorageProvider>();

export function defaultProviderName(): ProviderName {
    return normalizeProviderName(cfg.STORAGE_PROVIDER) ?? 'local';
}

/** The provider instance, or null when its configuration is incomplete. */
export function tryGetStorage(name?: string | null): StorageProvider | null {
    const n = normalizeProviderName(name ?? undefined) ?? defaultProviderName();
    const forced = override.get(n);
    if (forced) return forced;
    const cached = instances.get(n);
    if (cached) return cached;
    const built = builders[n]();
    if (built) instances.set(n, built);
    return built;
}

export function getStorage(name?: string | null): StorageProvider {
    const n = normalizeProviderName(name ?? undefined) ?? defaultProviderName();
    const provider = tryGetStorage(n);
    if (!provider) throw new AppError(`Storage provider "${n}" is not configured`, 503, 'storage_not_configured');
    return provider;
}

/** Providers whose configuration is complete (local is always available). */
export function configuredProviders(): ProviderName[] {
    return PROVIDER_NAMES.filter((n) => tryGetStorage(n) !== null);
}

/** Tests and embedding applications can plug in their own provider for a name. */
export function registerStorage(name: ProviderName, provider: StorageProvider | null): void {
    if (provider) override.set(name, provider);
    else override.delete(name);
}

export function resetStorageRegistry(): void {
    instances.clear();
    override.clear();
}
