# Cloud Storage Service

A self-hostable file storage service, a small Dropbox / S3 front end: upload (single, multiple, resumable chunked,
or straight to the object store with presigned URLs), download and stream with Range support, versions, trash,
sharing with people and with password-protected links, image processing, virus scanning, encryption at rest,
**end-to-end (client-side) encryption**, webhooks, Slack / Dropbox / Google Drive export, analytics, an admin
area, and nine storage back ends behind one interface.

It ships as a TypeScript Express API, a Next.js web app and a typed SDK that both the web app and Node scripts use.

## Features

**Files**
- Upload one file, up to 10 at once, or images scaled to fit 1920×1080
- Resumable chunked uploads: per-chunk SHA-256, parallel chunks, pause / resume / cancel, space reserved up front
- Direct uploads: the browser sends the bytes straight to the object store (presigned URL); the API checks size,
  real type and malware when the upload is confirmed and deletes it if it fails
- Download links that expire, streaming with HTTP Range (video / audio seek), thumbnails
- Real content-type detection from the file's bytes (magic numbers) against an allow-list; spoofed types are refused
- Versions (configurable history, restore, delete), trash with retention, automatic expiry, tags, search, sorting
- Per-user storage quota (reserved before bytes arrive, released on delete), activity log per file

**Sharing**
- With other users: read / write / admin permissions
- With anyone through a link: random token (only its hash is stored), optional password (bcrypt, attempt limit),
  expiry, download limit (enforced atomically), view-only links, revocation

**Security**
- JWT (HS256) with a token version: password change or "sign out everywhere" ends every older session; single
  tokens are revoked through Redis
- ClamAV scanning over the clamd `INSTREAM` protocol (streams, no temp copies); fails closed when the scanner is down
- Encryption at rest: AES-256-GCM per object, a key per object derived (HKDF) from `ENCRYPTION_KEY`, streamed both ways
- End-to-end encryption: files encrypted in the browser / SDK with a passphrase; the server only stores ciphertext
  (see below)
- Helmet headers, strict CORS, token-bucket rate limits (Redis, shared by all instances), signed URLs (HMAC),
  SSRF-safe webhooks, secrets refused in production when missing or weak

**Images** (sharp): resize, thumbnail, convert (jpeg / png / webp / avif), compress, auto-orient (as a new version),
metadata; results are stored as variants, the original is never changed

**Integrations**: signed outbound webhooks (HMAC-SHA256, retries with backoff, delivery log, secret rotation, auto-disable
after repeated failures), Slack messages, copy to Dropbox and Google Drive (streamed), CDN purge on change
(CloudFront or Cloudflare)

**Operations**: analytics dashboard (cached), admin (users, quotas, locking, system health, janitor), storage provider
administration (buckets, objects, presign), health and readiness probes, OpenAPI + Swagger UI, Prometheus metrics,
structured logs with request ids, nginx load balancing across three instances, Docker Compose, CI

## Architecture

```
                    browser (web app, SDK)
                              │
                    ┌─────────▼─────────┐
                    │   nginx :8080     │  load balancing (least_conn), body limit, rate limit,
                    │  nginx.conf       │  streaming uploads, request ids, static caching
                    └──┬─────┬─────┬──┬─┘
          ┌────────────┘     │     │  └──────────────┐
   ┌──────▼─────┐ ┌──────────▼┐ ┌──▼─────────┐ ┌─────▼──────┐
   │  api-1     │ │  api-2    │ │  api-3     │ │  web :3097 │  Next.js 14 (standalone)
   │  Express   │ │  Express  │ │  Express   │ └────────────┘
   └──┬───┬───┬─┘ └───────────┘ └────────────┘
      │   │   │      (every instance is identical and stateless)
      │   │   └──────────────► Object store: local disk │ S3 │ MinIO │ DigitalOcean │ Wasabi │ R2 │ B2 │ GCS │ Azure
      │   └──────────────────► Redis: cache, rate limits, token revocation, janitor lock (optional)
      ├──────────────────────► MongoDB: users, files, versions, sessions, links, webhooks, activity
      └──────────────────────► ClamAV (clamd :3310)
```

Inside the API, routes are thin: `routes/` → `controllers/` → `services/`. Every path that stores content goes
through `services/file.service.ts` (`ingest` / `commit`), and every byte read or written goes through
`services/objectStore.service.ts`, so quota, scanning, encryption and webhooks cannot be skipped on one path.

The design notes in [CLOUD_STORAGE_SERVICE_HLD_LLD.md](CLOUD_STORAGE_SERVICE_HLD_LLD.md) (cache, rate limiting,
structured logging, layers, nginx) and [CLOUD_STORAGE_IMPLEMENTATION.md](CLOUD_STORAGE_IMPLEMENTATION.md)
(storage providers) map to the code as follows:

| Design topic | Where |
|---|---|
| Distributed cache (get/set/delete, TTL, get-or-set, pattern invalidation) | `services/cache/cache.service.ts` (Redis, in-process fallback) |
| API rate limiting (token bucket, per key, Redis-backed) | `services/rate-limiting/rate-limiting.service.ts`, `middleware/rateLimits.ts` |
| Structured logging (correlation ids, user context, audit events) | `services/structured-logging/structured-logging.service.ts`, `config/logger.ts` |
| Controllers / REST API / middleware / models / configuration | `controllers/`, `routes/`, `middleware/`, `models/`, `config/` |
| Storage provider controllers (MinIO, DigitalOcean, B2, Wasabi, R2, GCS, Azure, S3) | `controllers/storage/*`, `services/storage/*` |
| Nginx reverse proxy and load balancing | `nginx.conf`, `docker-compose.yml` |

## Tech stack

| Part | Technology |
|---|---|
| API | Node.js 20+, TypeScript 5.6, Express 4, Mongoose 8 (MongoDB), ioredis 5, Joi, multer 2, sharp 0.33, winston 3, prom-client 15 |
| Storage | AWS SDK v3 (S3 and every S3-compatible store), @azure/storage-blob 12, @google-cloud/storage 7, local disk |
| Web app | Next.js 14 (app router, standalone output), React 18, Tailwind CSS 3 |
| SDK | `sdk/fileCloudSDK.ts`: fetch + Web Crypto, works in browsers and Node 18+ |
| Infrastructure | nginx, MongoDB 7, Redis 7, MinIO, ClamAV 1.4, Prometheus, Docker Compose, GitHub Actions |

## Project structure

```
cloud-storage-service/
├── app.ts / server.ts          Express app (routes, middleware, docs, probes, metrics) / process start and shutdown
├── config/                     env (validated), logger, redis, multer, s3 facade, CDN, OpenAPI
├── controllers/                HTTP handlers; controllers/storage/* = one admin controller per provider
├── middleware/                 auth, file access, validation (Joi), rate limits, cache, security, errors
├── models/                     User, File, UploadSession, PendingUpload, ShareLink, Webhook, WebhookDelivery, Integration, FileActivity
├── routes/                     auth, files, upload (chunked), images, shared, content, analytics, integrations, admin, storage
├── services/                   file lifecycle, uploads, direct uploads, object store, encryption, sharing, quota,
│   ├── storage/                  provider adapters: local, s3 (+ S3-compatibles), gcs, azure; registry
│   ├── cache/ rate-limiting/ structured-logging/   the HLD/LLD infrastructure services
│   └── metrics.service.ts      Prometheus metrics
├── utils/                      MIME detection, virus scanner (clamd), crypto, end-to-end parameters, image processing
├── sdk/                        typed client (also used by the web app)
├── frontend/                   Next.js web app (+ Dockerfile)
├── deploy/prometheus.yml       scrape config
├── nginx.conf                  load balancer / reverse proxy
├── docker-compose.yml          the whole stack
├── Dockerfile                  API image
└── tests/                      jest suites (see Tests)
```

## Getting started

### Everything with Docker Compose

```bash
cp .env.example .env
# set at least: JWT_SECRET (32+ chars), ENCRYPTION_KEY (openssl rand -hex 32), MINIO_ROOT_PASSWORD, ADMIN_EMAIL
docker compose up -d --build
```

Open http://localhost:8080 (web app and API behind nginx), http://localhost:8080/api-docs (Swagger UI) and
http://localhost:9001 (MinIO console). The account registered with `ADMIN_EMAIL` is an administrator.
ClamAV loads its signature database on first start, which takes a few minutes. Add `--profile monitoring` to also
start Prometheus on http://localhost:9090.

### Local development

Requirements: Node.js 20+, MongoDB; optional: Redis, ClamAV (clamd), an object store.

```bash
npm install
cp .env.example .env            # the defaults use local disk storage and MongoDB on localhost
npm run dev                     # API on http://localhost:5000 (tsx watch)

cd frontend
npm install
echo NEXT_PUBLIC_API_URL=http://localhost:5000/api > .env.local
npm run dev                     # web app on http://localhost:3097
```

Production build: `npm run build && npm start` for the API, `npm run build && npm start` in `frontend/`.

## Configuration

Every variable is listed and explained in [.env.example](.env.example); `config/env.ts` validates them at start-up.
In production the service refuses to start without a strong `JWT_SECRET` and an `ENCRYPTION_KEY`, with `CLIENT_URL=*`,
or with `WEBHOOK_ALLOW_PRIVATE=true`.

### Storage providers

`STORAGE_PROVIDER` picks the default for new files; every provider whose variables are set can also be chosen per
upload (`provider` field) or per user (Settings → default storage). Each file remembers where it lives.

| Provider | Variables | Implementation |
|---|---|---|
| Local disk | `LOCAL_STORAGE_PATH` | signed URLs served by the API |
| AWS S3 | `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | AWS SDK v3, multipart for streams |
| MinIO | `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | S3 API |
| DigitalOcean Spaces | `DO_BUCKET`, `DO_ACCESS_KEY_ID`, `DO_SECRET_ACCESS_KEY`, `DO_REGION` | S3 API |
| Wasabi | `WASABI_BUCKET`, `WASABI_ACCESS_KEY_ID`, `WASABI_SECRET_ACCESS_KEY` | S3 API |
| Cloudflare R2 | `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` | S3 API |
| Backblaze B2 | `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | B2's S3-compatible API |
| Google Cloud Storage | `GCS_BUCKET`, `GCS_KEY_FILENAME` (or application default credentials) | @google-cloud/storage, V4 signed URLs |
| Azure Blob Storage | `AZURE_STORAGE_CONNECTION_STRING` (or account + key), `AZURE_STORAGE_CONTAINER` | @azure/storage-blob, SAS URLs |

Administrators can list, create and delete buckets, browse objects and presign URLs for every configured provider
under `/api/storage/providers` (and in the Admin → System screen).

## End-to-end encryption

Tick **End-to-end** next to Upload in the web app (or call `sdk.uploadEncrypted`) and the file is encrypted in the
browser before it is sent. The server stores only ciphertext and these non-secret parameters, so nobody with access
to the server, the database or the bucket can read the file.

- Key: PBKDF2-SHA256 (310,000 iterations, random 16-byte salt) from the passphrase → AES-256-GCM key
- Content: cut into 1 MiB segments, each encrypted with nonce `prefix(8 bytes) || segment number(4 bytes)` and the
  additional data `pbkdf2-aes256gcm-v1:<i>:<count>`, so a changed, truncated, reordered or extended file fails to decrypt
- The server checks that the ciphertext length matches the declared plain size and that the declared real type is
  on the allow-list; large files use the resumable upload
- Opening: the drawer (and the public share page) ask for the passphrase and decrypt in the page; earlier versions
  each keep their own parameters, so they decrypt too
- Trade-offs, by design: the server cannot scan, preview, thumbnail or resize these files, exports to Dropbox / Drive
  are the encrypted copy, and a lost passphrase cannot be recovered

This is different from **encryption at rest** (`ENCRYPT_AT_REST` or the per-user setting), where the server encrypts
with its own key and decrypts on download, so scanning and previews keep working.

## API

The full, generated description is at `/api-docs` (Swagger UI) and `/openapi.json`. Authenticate with
`POST /api/auth/login` and send `Authorization: Bearer <token>`. Errors are `{ success: false, message, code, errors? }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/profile` · `PUT /api/auth/password` · `POST /api/auth/logout` · `POST /api/auth/logout-all` · `DELETE /api/auth/account` |
| Upload | `POST /api/files/upload` · `POST /api/files/upload-image` · `POST /api/files/upload-multiple` · `POST /api/files/presigned-url` · `POST /api/files/confirm-upload` |
| Resumable | `POST /api/upload/chunked` · `GET /api/upload/chunked` · `PUT /api/upload/chunked/:id` · `POST …/:id/complete` · `POST …/:id/pause` · `POST …/:id/resume` · `GET …/:id/status` · `DELETE …/:id` |
| Files | `GET /api/files` · `GET /api/files/stats` · `GET /api/files/capabilities` · `GET/PATCH/DELETE /api/files/:id` · `GET …/:id/download` · `GET …/:id/stream` · `GET …/:id/thumbnail` · `GET …/:id/activity` |
| Trash | `POST /api/files/:id/trash` · `POST /api/files/:id/restore` · `GET /api/files/trash` · `DELETE /api/files/trash` |
| Versions | `GET/POST /api/files/:id/versions` · `POST …/versions/:n/restore` · `DELETE …/versions/:n` |
| Sharing | `GET/POST /api/files/:id/shares` · `DELETE …/shares/:userId` · `GET/POST /api/files/:id/links` · `DELETE …/links/:linkId` |
| Public links | `GET /api/shared/:token` · `POST /api/shared/:token/download` · `POST /api/shared/:token/preview` · `GET /api/content/:token` |
| Images | `POST /api/images/resize` · `/thumbnail` · `/convert` · `/compress` · `/auto-orient` · `GET /api/images/:id/variants` · `GET …/metadata` · `DELETE …/variants/:variantId` |
| Analytics | `GET /api/analytics/dashboard` · `GET /api/analytics/storage` |
| Integrations | `GET /api/integrations` · `PUT/DELETE /api/integrations/:type` · `POST /api/integrations/slack` · `/dropbox` · `/google-drive` |
| Webhooks | `GET/POST /api/integrations/webhooks` · `PATCH/DELETE …/:id` · `POST …/:id/test` · `POST …/:id/rotate-secret` · `GET …/:id/deliveries` |
| Admin | `GET /api/admin/users` · `PATCH/DELETE /api/admin/users/:id` · `POST …/:id/recalculate-quota` · `GET /api/admin/stats` · `GET /api/admin/system` · `POST /api/admin/janitor/run` |
| Providers (admin) | `GET /api/storage/providers` · `GET/POST …/:provider/buckets` · `DELETE …/buckets/:bucket` · `GET …/buckets/:bucket/objects` · `GET …/buckets/:bucket/presign` |
| Operations | `GET /health` · `GET /health/ready` · `GET /metrics` · `GET /api-docs` · `GET /openapi.json` |

Webhook deliveries are POSTs with `X-Webhook-Event`, `X-Webhook-ID`, `X-Webhook-Attempt` and
`X-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` (verify with the secret shown when the webhook was
created; `verifySignatureHeader` in `services/webhook.service.ts` shows how).

### SDK

```ts
import FileCloudSDK from './sdk';

const sdk = new FileCloudSDK({ apiUrl: 'http://localhost:5000/api' });
await sdk.login('me@example.com', 'secret123');
const file = await sdk.upload(new Blob(['hello']), 'hello.txt', { tags: ['notes'] });
const big = await sdk.uploadLarge(bigBlob, 'video.mp4', { onProgress: (p) => console.log(p.percent) });
const secret = await sdk.uploadEncrypted(blob, 'passport.pdf', 'a long passphrase');
const { data } = await sdk.downloadDecrypted(secret._id, 'a long passphrase');
const link = await sdk.createLink(file._id, { password: 'pw', expiresInHours: 24 });
```

## Monitoring and logging

- **Logs** (`logs/`, rotated daily): `combined-*.log` (everything, JSON), `error-*.log`, `uploads-*.log` (upload and
  download events only). Every line carries the request id (`X-Request-Id`, accepted from nginx or generated) and the
  user id; audit events go through the structured logging service.
- **Metrics** at `/metrics` (Prometheus format, optional bearer `METRICS_TOKEN`; nginx does not expose it):
  `http_request_duration_seconds` (by method, route pattern, status), `cloudstorage_uploads_total{result,reason}`
  (stored / rejected and why), `cloudstorage_upload_size_bytes`, `cloudstorage_virus_detections_total`,
  `cloudstorage_downloads_total{via}` (api / share link), `cloudstorage_cache_lookups_total{namespace,result}`
  (cache hit rate), `cloudstorage_storage_used_bytes`, `cloudstorage_files`, `cloudstorage_users`, plus Node process metrics.
  `deploy/prometheus.yml` scrapes all three instances. CDN hit rates come from the CDN provider's own analytics.
- **Probes**: `/health` (process up) and `/health/ready` (MongoDB, default storage and Redis reachable).

## Deployment

- `docker-compose.yml` runs nginx + three API instances + the web app + MongoDB + Redis + MinIO + ClamAV
  (+ Prometheus with `--profile monitoring`). The instances are stateless: sessions, chunks and locks live in MongoDB,
  the object store and Redis, so any instance can serve any request.
- `nginx.conf` load-balances with `least_conn`, streams request bodies to the API (`proxy_request_buffering off`),
  limits bodies to 110 MB and requests to 20/s per address, passes its request id to the API, and keeps `/metrics` internal.
- Behind any other proxy set `TRUST_PROXY=true`, `PUBLIC_URL` and `CLIENT_URL` to the public address, and
  `<PROVIDER>_PUBLIC_ENDPOINT` when browsers reach the object store at another address than the API does.
- CI (`.github/workflows/ci.yml`): typecheck and build of the API and the web app, compose validation, both Docker
  image builds, and the jest suites (informational).

## What has been verified

Run on Windows against real services (throwaway instances), on 2026-10-19:

- **API end to end** (about 210 checks per run through the SDK and raw HTTP: auth, uploads of every kind, type
  spoofing, size and quota limits, virus rejection, resumable uploads with resume and checksum errors, direct uploads,
  versions, sharing, links, trash, images, encryption at rest, end-to-end encryption, webhooks with signature and
  retries, Slack / Dropbox / Drive calls against a local receiver, analytics, admin, provider administration, metrics,
  logs, rate limits) with each of these as the **default** store:
  local disk, S3 API (SeaweedFS, the same code path as AWS S3 / MinIO / DigitalOcean / Wasabi / R2 / B2),
  Azure Blob (Azurite), Google Cloud Storage (fake-gcs-server); with and without Redis. All passed.
- **Web app** in Edge (36 browser checks): sign-up, upload, preview, download, versions, share links and the public
  share page, end-to-end encryption including the visitor's page, trash, analytics, integrations, settings, admin,
  the bucket browser.
- **Load balancing**: the repository's `nginx.conf` (hosts swapped for local ports) in front of three API instances:
  even spread, 20 MB streamed upload, 413 above the limit, chunked upload across instances, revocation and rate limits
  shared through Redis, request ids, failover with one instance stopped (20 checks, all passed).

Not verified here: the Docker images and the compose stack (no Docker daemon on the test machine; the compose file is
validated with `docker compose config`), a real ClamAV daemon (the scanner was exercised against a clamd protocol
stub; real clamd speaks the same `zINSTREAM` protocol), real AWS / GCP / Azure accounts, CDN purges, and the real
Slack / Dropbox / Google Drive services.

## Tests

`npm test` runs the jest suites in `tests/` against MongoDB (`MONGODB_TEST_URI`). They predate the TypeScript
rewrite: 31 of 34 pass, the other 3 fail on duplicate fixture users inside the suites themselves. CI runs them as an
informational job.

## License

Proprietary - All rights reserved.

## Author

**Alakhdeep Singh**

- GitHub: [@Alakhdeepsingh](https://github.com/Alakhdeepsingh)
- LinkedIn: [Alakhdeep Singh](https://linkedin.com/in/alakhdeepsingh)
