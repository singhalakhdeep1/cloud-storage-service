import type { ProviderName } from '../../types/models';
import awsS3 from './awsS3Controller';
import azureBlob from './azureBlobController';
import backblaze from './backblazeController';
import type { ProviderController } from './base';
import cloudflareR2 from './cloudflareR2Controller';
import digitalOcean from './digitalOceanController';
import gcs from './gcsController';
import minio from './minioController';
import wasabi from './wasabiController';

/** The administration controller of each cloud provider (`local` has no buckets). */
export const providerControllers: Partial<Record<ProviderName, ProviderController>> = {
    s3: awsS3,
    minio,
    digitalocean: digitalOcean,
    wasabi,
    r2: cloudflareR2,
    b2: backblaze,
    gcs,
    azure: azureBlob,
};

export { awsS3, azureBlob, backblaze, cloudflareR2, digitalOcean, gcs, minio, wasabi };
