const axios = require('axios');
const logger = require('./logger');

// Cloudflare CDN configuration
class CloudflareCDN {
    constructor() {
        this.apiKey = process.env.CLOUDFLARE_API_KEY;
        this.email = process.env.CLOUDFLARE_EMAIL;
        this.zoneId = process.env.CLOUDFLARE_ZONE_ID;
        this.cdnUrl = process.env.CDN_URL;
        this.enabled = !!(this.apiKey && this.email && this.zoneId);
    }

    // Purge cache for specific URLs
    async purgeUrls(urls) {
        if (!this.enabled) {
            logger.warn('Cloudflare CDN not configured');
            return false;
        }

        try {
            const response = await axios.post(
                `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`,
                { files: urls },
                {
                    headers: {
                        'X-Auth-Email': this.email,
                        'X-Auth-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.success) {
                logger.info(`Cloudflare cache purged for ${urls.length} URLs`);
                return true;
            } else {
                logger.error('Cloudflare purge failed:', response.data.errors);
                return false;
            }
        } catch (error) {
            logger.error('Cloudflare purge error:', error);
            return false;
        }
    }

    // Purge entire cache
    async purgeAll() {
        if (!this.enabled) {
            logger.warn('Cloudflare CDN not configured');
            return false;
        }

        try {
            const response = await axios.post(
                `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`,
                { purge_everything: true },
                {
                    headers: {
                        'X-Auth-Email': this.email,
                        'X-Auth-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.success) {
                logger.info('Cloudflare entire cache purged');
                return true;
            } else {
                logger.error('Cloudflare purge all failed:', response.data.errors);
                return false;
            }
        } catch (error) {
            logger.error('Cloudflare purge all error:', error);
            return false;
        }
    }

    // Get CDN URL for a file
    getCdnUrl(key) {
        if (!this.cdnUrl) {
            return null;
        }
        return `${this.cdnUrl}/${key}`;
    }

    // Check if CDN is enabled
    isEnabled() {
        return this.enabled;
    }
}

// CloudFront CDN configuration
class CloudFrontCDN {
    constructor() {
        this.distributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION;
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.enabled = !!this.distributionId;
    }

    // Create invalidation for CloudFront
    async createInvalidation(paths) {
        if (!this.enabled) {
            logger.warn('CloudFront CDN not configured');
            return false;
        }

        try {
            const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
            
            const client = new CloudFrontClient({
                region: this.region,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            });

            const callerReference = Date.now().toString();
            
            const command = new CreateInvalidationCommand({
                DistributionId: this.distributionId,
                InvalidationBatch: {
                    CallerReference: callerReference,
                    Paths: {
                        Quantity: paths.length,
                        Items: paths
                    }
                }
            });

            const response = await client.send(command);
            
            if (response.Invalidation) {
                logger.info(`CloudFront invalidation created: ${response.Invalidation.Id}`);
                return response.Invalidation.Id;
            }
            
            return false;
        } catch (error) {
            logger.error('CloudFront invalidation error:', error);
            return false;
        }
    }

    // Get CDN URL for a file
    getCdnUrl(key) {
        if (!this.distributionId) {
            return null;
        }
        return `https://${this.distributionId}.cloudfront.net/${key}`;
    }

    // Check if CDN is enabled
    isEnabled() {
        return this.enabled;
    }
}

// Generic CDN manager
class CDNManager {
    constructor() {
        this.cloudflare = new CloudflareCDN();
        this.cloudfront = new CloudFrontCDN();
        this.provider = process.env.CDN_PROVIDER || 'cloudfront';
    }

    // Purge cache for specific URLs
    async purgeUrls(urls) {
        if (this.provider === 'cloudflare') {
            return await this.cloudflare.purgeUrls(urls);
        } else if (this.provider === 'cloudfront') {
            // Convert URLs to paths for CloudFront
            const paths = urls.map(url => url.replace(/^https?:\/\/[^\/]+/, ''));
            return await this.cloudfront.createInvalidation(paths);
        }
        return false;
    }

    // Purge entire cache
    async purgeAll() {
        if (this.provider === 'cloudflare') {
            return await this.cloudflare.purgeAll();
        } else if (this.provider === 'cloudfront') {
            return await this.cloudfront.createInvalidation(['/*']);
        }
        return false;
    }

    // Get CDN URL for a file
    getCdnUrl(key) {
        if (this.provider === 'cloudflare') {
            return this.cloudflare.getCdnUrl(key);
        } else if (this.provider === 'cloudfront') {
            return this.cloudfront.getCdnUrl(key);
        }
        return null;
    }

    // Check if CDN is enabled
    isEnabled() {
        if (this.provider === 'cloudflare') {
            return this.cloudflare.isEnabled();
        } else if (this.provider === 'cloudfront') {
            return this.cloudfront.isEnabled();
        }
        return false;
    }
}

module.exports = {
    CloudflareCDN,
    CloudFrontCDN,
    CDNManager
};
