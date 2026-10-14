/** CDN integration: purge cached copies when a file is replaced or deleted, and build CDN URLs for public files. */
import axios from 'axios';
import cfg from './env';
import logger from './logger';

export class CloudflareCDN {
    private readonly apiKey = cfg.CLOUDFLARE_API_KEY;
    private readonly email = cfg.CLOUDFLARE_EMAIL;
    private readonly zoneId = cfg.CLOUDFLARE_ZONE_ID;
    private readonly cdnUrl = cfg.CDN_URL;
    readonly enabled = Boolean(this.apiKey && this.email && this.zoneId);

    private async purge(body: Record<string, unknown>): Promise<boolean> {
        if (!this.enabled) {
            logger.warn('Cloudflare CDN not configured');
            return false;
        }
        try {
            const res = await axios.post(`${cfg.CLOUDFLARE_API_URL}/zones/${this.zoneId}/purge_cache`, body, {
                headers: { 'X-Auth-Email': this.email as string, 'X-Auth-Key': this.apiKey as string, 'Content-Type': 'application/json' },
                timeout: 10_000,
            });
            if (res.data?.success) return true;
            logger.error('Cloudflare purge failed', { errors: res.data?.errors });
            return false;
        } catch (e) {
            logger.error('Cloudflare purge error', { err: (e as Error).message });
            return false;
        }
    }

    purgeUrls(urls: string[]): Promise<boolean> {
        return this.purge({ files: urls });
    }

    purgeAll(): Promise<boolean> {
        return this.purge({ purge_everything: true });
    }

    getCdnUrl(key: string): string | null {
        return this.cdnUrl ? `${this.cdnUrl}/${key}` : null;
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}

export class CloudFrontCDN {
    private readonly distributionId = cfg.AWS_CLOUDFRONT_DISTRIBUTION;
    readonly enabled = Boolean(this.distributionId);

    async createInvalidation(paths: string[]): Promise<string | false> {
        if (!this.enabled) {
            logger.warn('CloudFront CDN not configured');
            return false;
        }
        try {
            // loaded on first use: only deployments behind CloudFront need the SDK
            const { CloudFrontClient, CreateInvalidationCommand } = await import('@aws-sdk/client-cloudfront');
            const client = new CloudFrontClient({
                region: cfg.AWS_REGION,
                credentials: cfg.AWS_ACCESS_KEY_ID && cfg.AWS_SECRET_ACCESS_KEY ? { accessKeyId: cfg.AWS_ACCESS_KEY_ID, secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY } : undefined,
            });
            const out = await client.send(
                new CreateInvalidationCommand({
                    DistributionId: this.distributionId,
                    InvalidationBatch: { CallerReference: `${Date.now()}-${Math.random().toString(36).slice(2)}`, Paths: { Quantity: paths.length, Items: paths } },
                })
            );
            return out.Invalidation?.Id ?? false;
        } catch (e) {
            logger.error('CloudFront invalidation error', { err: (e as Error).message });
            return false;
        }
    }

    getCdnUrl(key: string): string | null {
        return cfg.CDN_URL ? `${cfg.CDN_URL}/${key}` : this.distributionId ? `https://${this.distributionId}.cloudfront.net/${key}` : null;
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}

/** Picks the CDN configured by CDN_PROVIDER (cloudfront or cloudflare). */
export class CDNManager {
    readonly cloudflare = new CloudflareCDN();
    readonly cloudfront = new CloudFrontCDN();
    readonly provider = cfg.CDN_PROVIDER;

    async purgeUrls(urls: string[]): Promise<boolean | string> {
        if (this.provider === 'cloudflare') return this.cloudflare.purgeUrls(urls);
        if (this.provider === 'cloudfront') return this.cloudfront.createInvalidation(urls.map((u) => u.replace(/^https?:\/\/[^/]+/, '')));
        return false;
    }

    async purgeAll(): Promise<boolean | string> {
        if (this.provider === 'cloudflare') return this.cloudflare.purgeAll();
        if (this.provider === 'cloudfront') return this.cloudfront.createInvalidation(['/*']);
        return false;
    }

    getCdnUrl(key: string): string | null {
        return this.provider === 'cloudflare' ? this.cloudflare.getCdnUrl(key) : this.provider === 'cloudfront' ? this.cloudfront.getCdnUrl(key) : null;
    }

    isEnabled(): boolean {
        return this.provider === 'cloudflare' ? this.cloudflare.isEnabled() : this.provider === 'cloudfront' ? this.cloudfront.isEnabled() : false;
    }
}

export const cdn = new CDNManager();
