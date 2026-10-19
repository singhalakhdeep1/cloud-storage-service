# Cloud Storage Service - HLD/LLD Implementation

## Overview
This document provides comprehensive documentation for HLD/LLD patterns implemented in the Cloud Storage Service application (Node.js/Express, TypeScript). Every topic below is implemented and was verified against real Redis, MongoDB and object stores; see README.md.

## Implemented Topics

### LLD Topics (Low-Level Design)

#### 1. Distributed Caching
**Location:** `services/cache/cache.service.ts`

**Description:** Implements distributed caching with Redis for cloud storage platform data (bounded in-process fallback when Redis is not configured; a cache failure never fails a request). Used for analytics responses, token revocation, share-link attempt limits and the janitor lock.

**Key Features:**
- Get/set/delete operations
- TTL support
- Get or set pattern
- Pattern-based invalidation

**Usage Example:**
```typescript
import { CacheService } from './services/cache/cache.service';

const cache = new CacheService('files');
const cached = await cache.get('file:123');
await cache.set('file:123', JSON.stringify(file), 3600);
```

#### 2. API Rate Limiting
**Location:** `services/rate-limiting/rate-limiting.service.ts`

**Description:** Implements token bucket algorithm for API rate limiting. On Redis the refill-and-take step is one Lua script, atomic across instances; `middleware/rateLimits.ts` applies it to the API, uploads, sign-in, registration, public links and heavy operations.

**Key Features:**
- Token bucket algorithm
- Per-key rate limiting
- Configurable bucket capacity
- Redis-backed storage

**Usage Example:**
```typescript
import RateLimitingService from './services/rate-limiting/rate-limiting.service';

const rateLimiting = new RateLimitingService();
const allowed = await rateLimiting.isAllowed(`user:${userId}`, 1);
```

#### 3. Structured Logging
**Location:** `services/structured-logging/structured-logging.service.ts`

**Description:** Implements structured logging with correlation IDs and context (AsyncLocalStorage per request; the id comes from `X-Request-Id`, e.g. set by nginx, or is generated).

**Key Features:**
- Structured log entries
- Correlation ID tracking
- User context tracking
- Audit event logging

**Usage Example:**
```typescript
import { structuredLogger as logging } from './services/structured-logging/structured-logging.service';

logging.logAuditEvent('FileUploaded', 'User uploaded a file', { userId, fileId });
```

### HLD Topics (High-Level Design)

#### 1. Cloud Storage Controllers
**Location:** `controllers/` (Already exists)

**Description:** Controllers for file upload, download, and management operations; `controllers/storage/*` holds one administration controller per provider (S3, MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi, Cloudflare R2, GCS, Azure).

#### 2. REST API
**Location:** `routes/` (Already exists)

**Description:** REST API endpoints for storage operations.

#### 3. Middleware
**Location:** `middleware/` (Already exists)

**Description:** Middleware for authentication, file validation, and request processing.

#### 4. Models
**Location:** `models/` (Already exists)

**Description:** Data models for files, users, and storage buckets.

#### 5. Configuration
**Location:** `config/` (Already exists)

**Description:** Validated configuration (`config/env.ts`) for storage providers (local, S3 and S3-compatibles, Azure, GCS), Redis, ClamAV, CDN and secrets.

#### 6. Nginx
**Location:** `nginx.conf` (Already exists)

**Description:** Nginx configuration for reverse proxy and load balancing: three API instances (`least_conn`, failover), the web app, streamed uploads, body and request-rate limits. `docker-compose.yml` runs it with the whole stack.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Nginx Reverse Proxy                      │
│  (Load Balancing, SSL Termination)                         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     Express Server                            │
│  (REST API, Middleware, Rate Limiting)                      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Controllers  │  │   Routes     │  │   Config     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  (Upload, Download, Buckets, Files, Multi-provider)         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Cache     │  │Rate Limiting │  │ Structured   │      │
│  │   (Redis)    │  │  Service     │  │   Logging    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   S3/Azure   │  │   Models     │  │   Utils      │      │
│  │   (Storage)   │  │  (Data)      │  │  (Helpers)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Environment variables:

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Rate Limiting
RATE_LIMIT_BUCKET_CAPACITY=100
RATE_LIMIT_REFILL_RATE=1

# Storage Providers
AWS_S3_BUCKET=your-s3-bucket
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AZURE_STORAGE_ACCOUNT=your-azure-account
AZURE_STORAGE_KEY=your-azure-key
GCS_BUCKET=your-gcs-bucket
GCS_KEY_FILE=path/to/key.json
```

## Summary

This implementation provides Cloud Storage Service-specific HLD/LLD patterns focusing on distributed caching, rate limiting, and structured logging. The platform already includes extensive infrastructure with cloud storage controllers for file operations, REST API endpoints, middleware for authentication and validation, data models for files and buckets, configuration for multiple storage providers (S3, Azure, GCS), and Nginx for reverse proxy and load balancing, making it a comprehensive cloud storage platform with multi-provider support and modern API capabilities.

## Tech Stack Coverage Summary

Comprehensive HLD/LLD implementation across major tech stacks:

1. ✅ **bankcore-dotnet** (.NET/C#) - All 15 topics
2. ✅ **ferrobank** (Rust) - All 15 topics
3. ✅ **finrails** (Ruby on Rails) - All 15 topics
4. ✅ **finvault-go** (Go) - All 15 topics
5. ✅ **springbank** (Java/Spring Boot) - All 15 topics
6. ✅ **ecommerce-platform** (Node.js) - All 15 topics
7. ✅ **cartwave** (Python/Django) - All 15 topics
8. ✅ **microservices-architecture** (K8s) - Microservices-specific patterns
9. ✅ **trove** (NestJS/TypeScript) - Marketplace-specific patterns
10. ✅ **stratum** (NestJS/TypeScript) - Platform-specific patterns
11. ✅ **node-microservices** (Node.js) - Microservices-specific patterns
12. ✅ **ResilienceForge** (DevOps/K8s) - DevOps-specific patterns
13. ✅ **production-node-api** (Node.js) - Production-specific patterns
14. ✅ **dispatch** (TypeScript/Node.js) - Dispatch-specific patterns
15. ✅ **recruitment-api** (TypeScript/Node.js) - Recruitment-specific patterns
16. ✅ **social-network-api** (TypeScript/Node.js) - Social network-specific patterns
17. ✅ **CodeBridge** (Next.js/TypeScript) - Collaborative coding-specific patterns
18. ✅ **TalentIQ** (TypeScript/Node.js) - Talent management-specific patterns
19. ✅ **Nexus-AI** (Next.js/TypeScript) - AI platform-specific patterns
20. ✅ **PulseStream** (Next.js/TypeScript) - Streaming platform-specific patterns
21. ✅ **Forge3D** (Next.js/TypeScript) - 3D engine-specific patterns
22. ✅ **LexAI** (Next.js/TypeScript) - Document processing AI-specific patterns
23. ✅ **SecureDeploy** (NestJS/TypeScript) - Security platform-specific patterns
24. ✅ **Aurum** (Next.js/TypeScript) - Fintech platform-specific patterns
25. ✅ **Grove** (NestJS/TypeScript) - Education platform-specific patterns
26. ✅ **DevForge** (Node.js/TypeScript) - Development platform-specific patterns
27. ✅ **Civitas** (NestJS/TypeScript) - Civic engagement-specific patterns
28. ✅ **MedMind** (Node.js/TypeScript) - Healthcare platform-specific patterns
29. ✅ **Telemedicine Platform** (NestJS/TypeScript) - Telemedicine-specific patterns
30. ✅ **StreamVault** (NestJS/TypeScript) - Video streaming-specific patterns
31. ✅ **Settle** (NestJS/TypeScript) - Payment platform-specific patterns
32. ✅ **DocVault** (NestJS/TypeScript) - Document management-specific patterns
33. ✅ **Meridian** (Next.js/TypeScript) - Logistics platform-specific patterns
34. ✅ **Mosaic** (Next.js/TypeScript) - Multi-tenant platform-specific patterns
35. ✅ **Messaging Service** (Node.js/Express) - Messaging platform-specific patterns
36. ✅ **Identity Service** (Node.js/Express) - Identity management-specific patterns
37. ✅ **Cloud Storage Service** (Node.js/Express) - Cloud storage-specific patterns

The remaining 18+ projects will receive relevant patterns based on their specific domain and requirements, following the Option 2 strategy for comprehensive tech stack coverage without redundant work.
