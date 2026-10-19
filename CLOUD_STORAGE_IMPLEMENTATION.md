# Cloud Storage Service - Implementation

## Overview
This document describes the cloud storage provider integrations added to the cloud-storage-service project.

## Technologies Added

Every provider implements one storage interface (`services/storage/types.ts`: put / get with byte ranges / head /
delete / list / presigned download / presigned upload / ping, plus bucket administration), chosen per file through
`services/storage/registry.ts`. The S3-compatible stores share one adapter built on the AWS SDK v3.

| Provider | Adapter | Protocol |
|---|---|---|
| 1. MinIO | `services/storage/s3.provider.ts` | S3 API (path-style) |
| 2. DigitalOcean Spaces | `services/storage/s3.provider.ts` | S3 API |
| 3. Backblaze B2 | `services/storage/s3.provider.ts` | B2's S3-compatible API (application key id + key) |
| 4. Wasabi | `services/storage/s3.provider.ts` | S3 API |
| 5. Cloudflare R2 | `services/storage/s3.provider.ts` | S3 API |
| 6. Google Cloud Storage | `services/storage/gcs.provider.ts` | @google-cloud/storage, V4 signed URLs |
| 7. Azure Blob Storage | `services/storage/azure.provider.ts` | @azure/storage-blob, SAS URLs |
| AWS S3 and local disk | `s3.provider.ts`, `local.provider.ts` | AWS SDK v3 / signed API URLs |

## Files Created

### Controllers (in controllers/storage/)
- `minioController.ts` - MinIO controller
- `digitalOceanController.ts` - DigitalOcean Spaces controller
- `backblazeController.ts` - Backblaze B2 controller (including `getDownloadAuthorization`)
- `wasabiController.ts` - Wasabi controller
- `cloudflareR2Controller.ts` - Cloudflare R2 controller
- `gcsController.ts` - Google Cloud Storage controller
- `azureBlobController.ts` - Azure Blob Storage controller
- `awsS3Controller.ts` - AWS S3 controller
- `base.ts` - the shared operations; `index.ts` - controller per provider

They are exposed to administrators under `/api/storage/providers/:provider/...` (buckets, objects, presign) and in
the web app under Admin → System → Buckets and objects.

## Features

### MinIO Controller
- File and buffer upload
- File download
- File deletion
- File listing
- Bucket creation/deletion
- Presigned URLs
- Bucket existence check

### DigitalOcean Spaces Controller
- File upload/download
- File deletion
- File listing
- Bucket creation/deletion
- Presigned URLs
- Bucket existence check

### Backblaze B2 Controller
- Authorization management
- File upload/download
- File deletion
- File listing
- Bucket creation/deletion
- Download authorization
- Bucket listing

### Wasabi Controller
- File upload/download
- File deletion
- File listing
- Bucket creation/deletion
- Presigned URLs
- Bucket existence check

### Cloudflare R2 Controller
- File upload/download
- File deletion
- File listing
- Bucket creation/deletion
- Presigned URLs
- Bucket existence check
- Bucket listing

### Google Cloud Storage Controller
- File upload/download
- File deletion
- File listing
- Bucket creation/deletion
- Signed URLs
- Bucket existence check
- Bucket listing

### Azure Blob Storage Controller
- Blob upload/download
- Blob deletion
- Blob listing
- Container creation/deletion
- Blob URL generation
- SAS URL generation
- Container existence check
- Container listing

## Installation

The SDKs are dependencies in `package.json` (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`,
`@aws-sdk/s3-request-presigner`, `@google-cloud/storage`, `@azure/storage-blob`); `npm install` installs them. They
are loaded only when their provider is first used.

## Environment Variables

A provider is available when its variables are set (`.env.example` lists them all); `STORAGE_PROVIDER` picks the
default for new files.

```env
# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=files

# DigitalOcean Spaces
DO_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_ACCESS_KEY_ID=your_access_key
DO_SECRET_ACCESS_KEY=your_secret_key
DO_REGION=nyc3
DO_BUCKET=your_space

# Backblaze B2 (B2_ACCOUNT_ID is accepted for B2_KEY_ID)
B2_KEY_ID=your_application_key_id
B2_APPLICATION_KEY=your_application_key
B2_BUCKET=your_bucket

# Wasabi
WASABI_ENDPOINT=https://s3.wasabisys.com
WASABI_ACCESS_KEY_ID=your_access_key
WASABI_SECRET_ACCESS_KEY=your_secret_key
WASABI_REGION=us-east-1
WASABI_BUCKET=your_bucket

# Cloudflare R2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=your_bucket

# Google Cloud Storage
GCS_PROJECT_ID=your_project_id
GCS_KEY_FILENAME=path/to/keyfile.json
GCS_BUCKET=your_bucket

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_STORAGE_CONTAINER=files
```

## Notes
- Verified end to end with each of these as the default store: S3 API (SeaweedFS, the code path of MinIO, Spaces,
  B2, Wasabi and R2), Azure Blob (Azurite) and GCS (fake-gcs-server). Real cloud accounts were not used.
- Browsers upload and download straight from the provider with presigned URLs; when browsers reach the store at
  another address than the API (Docker), set `<PREFIX>_PUBLIC_ENDPOINT` (e.g. `MINIO_PUBLIC_ENDPOINT`).
- Google Cloud Storage needs a service-account key (or application default credentials) to sign URLs.
