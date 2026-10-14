/**
 * Client SDK for the Cloud Storage Service. Works in the browser and in Node 18+ (it only needs `fetch`, `FormData`,
 * `Blob` and Web Crypto). The web app uses this same SDK.
 *
 *   const sdk = new FileCloudSDK({ apiUrl: 'https://files.example.com/api' });
 *   await sdk.login('me@example.com', 'secret');
 *   const file = await sdk.upload(new Blob(['hello']), 'hello.txt');
 *   const big = await sdk.uploadLarge(bigBlob, 'video.mp4', { onProgress: (p) => console.log(p.percent) });
 */

export class FileCloudError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
        readonly errors?: { field: string; message: string }[]
    ) {
        super(message);
        this.name = 'FileCloudError';
    }
}

export interface SDKOptions {
    apiUrl?: string;
    token?: string | null;
    /** Called when the API answers 401 (token expired / revoked), so the app can send the user to sign in. */
    onUnauthorized?: () => void;
    fetch?: typeof fetch;
}

export interface UserInfo {
    id: string;
    name: string;
    email: string;
    role: 'user' | 'admin';
    storageUsed: number;
    storageLimit: number;
    fileCount: number;
    preferences: { defaultStorage?: string; autoProcessImages: boolean; enableVirusScan: boolean; encryptFiles: boolean };
}

export interface FileInfo {
    _id: string;
    originalName: string;
    mimetype: string;
    size: number;
    category: 'image' | 'video' | 'document' | 'audio' | 'other';
    provider: string;
    permission: 'owner' | 'admin' | 'write' | 'read' | 'none';
    isPublic: boolean;
    accessControl: 'private' | 'public' | 'shared';
    isEncrypted: boolean;
    tags: string[];
    description?: string;
    currentVersion: number;
    downloadCount: number;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    deletedAt?: string | null;
    metadata?: { width?: number; height?: number; format?: string; compressed?: boolean };
    variants: { id: string; type: string; size: number; dimensions?: { width?: number; height?: number }; format?: string; mimetype?: string }[];
    versions: { id: string; versionNumber: number; size: number; mimetype?: string; uploadedAt: string; reason?: string }[];
    sharedWith?: { user: string; permission: string }[];
    sharedWithCount: number;
    thumbnailUrl?: string;
    checksum?: string;
    virusScanned: boolean;
}

export interface Page<T> {
    files: T[];
    pagination: { page: number; limit: number; total: number; pages: number };
}

export interface ListParams {
    scope?: 'mine' | 'shared' | 'all';
    page?: number;
    limit?: number;
    category?: string;
    tag?: string;
    search?: string;
    sort?: 'createdAt' | 'updatedAt' | 'name' | 'size';
    order?: 'asc' | 'desc';
}

export interface Progress {
    loaded: number;
    total: number;
    percent: number;
    /** Chunk numbers confirmed by the server (resumable uploads). */
    chunksDone?: number;
    chunksTotal?: number;
}

export interface UploadOptions {
    isPublic?: boolean;
    tags?: string[];
    description?: string;
    expiresAt?: string | Date;
    provider?: string;
    onProgress?: (p: Progress) => void;
    signal?: AbortSignal;
}

export interface LargeUploadOptions extends UploadOptions {
    /** Bytes per chunk (default 5 MB, the server accepts 1 KB to 10 MB). */
    chunkSize?: number;
    /** Chunks sent at the same time (default 3). */
    concurrency?: number;
    /** Continue an earlier session instead of starting a new one. */
    uploadId?: string;
    /** Make the upload a new version of this file. */
    versionOf?: string;
    onSession?: (uploadId: string) => void;
}

type Json = Record<string, unknown>;

const q = (params: Record<string, unknown> = {}): string => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
    const out = s.toString();
    return out ? `?${out}` : '';
};

async function sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FileCloudSDK {
    apiUrl: string;
    token: string | null;
    private readonly onUnauthorized?: () => void;
    private readonly fetchImpl: typeof fetch;

    constructor(options: SDKOptions = {}) {
        this.apiUrl = (options.apiUrl ?? 'http://localhost:5000/api').replace(/\/+$/, '');
        this.token = options.token ?? null;
        this.onUnauthorized = options.onUnauthorized;
        this.fetchImpl = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    /* ------------------------------------------------------------ plumbing */

    async request<T = Json>(method: string, path: string, options: { json?: unknown; form?: FormData; signal?: AbortSignal; auth?: boolean } = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.token && options.auth !== false) headers.Authorization = `Bearer ${this.token}`;
        let body: BodyInit | undefined;
        if (options.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.json);
        } else if (options.form) body = options.form;
        const res = await this.fetchImpl(`${this.apiUrl}${path}`, { method, headers, body, signal: options.signal });
        const text = await res.text();
        let data: Json = {};
        try {
            data = text ? (JSON.parse(text) as Json) : {};
        } catch {
            /* not JSON */
        }
        if (!res.ok) {
            if (res.status === 401 && this.token) this.onUnauthorized?.();
            throw new FileCloudError((data.message as string) || (data.error as string) || `Request failed (${res.status})`, res.status, data.code as string | undefined, data.errors as FileCloudError['errors']);
        }
        return data as T;
    }

    /** Absolute URL of an API path (for `<img src>` etc. with signed URLs). */
    url(path: string): string {
        return `${this.apiUrl}${path}`;
    }

    /* ---------------------------------------------------------------- auth */

    async register(name: string, email: string, password: string): Promise<UserInfo> {
        const r = await this.request<{ token: string; data: { user: UserInfo } }>('POST', '/auth/register', { json: { name, email, password }, auth: false });
        this.token = r.token;
        return r.data.user;
    }

    async login(email: string, password: string): Promise<UserInfo> {
        const r = await this.request<{ token: string; data: { user: UserInfo } }>('POST', '/auth/login', { json: { email, password }, auth: false });
        this.token = r.token;
        return r.data.user;
    }

    async me(): Promise<UserInfo> {
        return (await this.request<{ data: { user: UserInfo } }>('GET', '/auth/me')).data.user;
    }

    async logout(): Promise<void> {
        await this.request('POST', '/auth/logout').catch(() => undefined);
        this.token = null;
    }

    logoutEverywhere(): Promise<Json> {
        return this.request('POST', '/auth/logout-all');
    }

    async updateProfile(patch: { name?: string; preferences?: { defaultStorage?: string | null; autoProcessImages?: boolean; enableVirusScan?: boolean; encryptFiles?: boolean } }): Promise<UserInfo> {
        return (await this.request<{ data: { user: UserInfo } }>('PUT', '/auth/profile', { json: patch })).data.user;
    }

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        const r = await this.request<{ token: string }>('PUT', '/auth/password', { json: { currentPassword, newPassword } });
        this.token = r.token;
    }

    deactivateAccount(password: string): Promise<Json> {
        return this.request('DELETE', '/auth/account', { json: { password } });
    }

    /* --------------------------------------------------------------- files */

    async list(params: ListParams = {}): Promise<Page<FileInfo>> {
        return (await this.request<{ data: Page<FileInfo> }>('GET', `/files${q({ ...params })}`)).data;
    }

    async get(id: string): Promise<FileInfo> {
        return (await this.request<{ data: FileInfo }>('GET', `/files/${id}`)).data;
    }

    async update(id: string, patch: { name?: string; tags?: string[]; description?: string; isPublic?: boolean; accessControl?: string; expiresAt?: string | null }): Promise<FileInfo> {
        return (await this.request<{ data: FileInfo }>('PATCH', `/files/${id}`, { json: patch })).data;
    }

    private uploadForm(field: string, data: Blob, name: string, o: UploadOptions): FormData {
        const form = new FormData();
        if (o.isPublic !== undefined) form.append('isPublic', String(o.isPublic));
        if (o.tags?.length) form.append('tags', o.tags.join(','));
        if (o.description) form.append('description', o.description);
        if (o.expiresAt) form.append('expiresAt', new Date(o.expiresAt).toISOString());
        if (o.provider) form.append('provider', o.provider);
        form.append(field, data, name);
        return form;
    }

    /**
     * POST a form with upload progress where the platform allows it (XMLHttpRequest in browsers), plain fetch otherwise.
     */
    private send<T>(method: string, path: string, form: FormData, o: UploadOptions): Promise<T> {
        if (typeof XMLHttpRequest === 'undefined' || !o.onProgress) return this.request<T>(method, path, { form, signal: o.signal });
        return new Promise<T>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, `${this.apiUrl}${path}`);
            if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress?.({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
            xhr.onerror = () => reject(new FileCloudError('Network error', 0));
            xhr.onabort = () => reject(new FileCloudError('Upload cancelled', 0, 'aborted'));
            xhr.onload = () => {
                let data: Json = {};
                try {
                    data = JSON.parse(xhr.responseText) as Json;
                } catch {
                    /* ignore */
                }
                if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
                else {
                    if (xhr.status === 401 && this.token) this.onUnauthorized?.();
                    reject(new FileCloudError((data.message as string) || `Upload failed (${xhr.status})`, xhr.status, data.code as string | undefined, data.errors as FileCloudError['errors']));
                }
            };
            o.signal?.addEventListener('abort', () => xhr.abort());
            xhr.send(form);
        });
    }

    /** Uploads one file through the API (up to the server's MAX_FILE_SIZE). */
    async upload(data: Blob, name: string, options: UploadOptions = {}): Promise<FileInfo> {
        return (await this.send<{ data: FileInfo }>('POST', '/files/upload', this.uploadForm('file', data, name, options), options)).data;
    }

    async uploadMany(files: { data: Blob; name: string }[], options: UploadOptions = {}): Promise<{ files: FileInfo[]; failed: { name: string; error: string }[] }> {
        const form = new FormData();
        for (const f of files) form.append('files', f.data, f.name);
        const r = await this.send<{ data: FileInfo[]; failed?: { name: string; error: string }[] }>('POST', '/files/upload-multiple', form, options);
        return { files: r.data, failed: r.failed ?? [] };
    }

    /** An image, scaled down to at most 1920x1080 by the server. */
    async uploadImage(data: Blob, name: string, options: UploadOptions = {}): Promise<FileInfo> {
        return (await this.send<{ data: FileInfo }>('POST', '/files/upload-image', this.uploadForm('image', data, name, options), options)).data;
    }

    /**
     * Resumable upload for big files: the file is cut into chunks, sent several at a time with a checksum each, and
     * can be continued after a failure by passing the same `uploadId` again. Returns the finished file.
     */
    async uploadLarge(data: Blob, name: string, options: LargeUploadOptions = {}): Promise<FileInfo> {
        const chunkSize = options.chunkSize ?? 5 * 1024 * 1024;
        let uploadId = options.uploadId;
        let totalChunks: number;
        let have = new Set<number>();
        if (uploadId) {
            const st = (await this.request<{ data: { totalChunks: number; uploadedChunks: number[]; missingChunks: number[] } }>('POST', `/upload/chunked/${uploadId}/resume`)).data;
            totalChunks = st.totalChunks;
            have = new Set(st.uploadedChunks);
        } else {
            const init = (
                await this.request<{ data: { uploadId: string; totalChunks: number; chunkSize: number } }>('POST', '/upload/chunked', {
                    json: { originalName: name, filename: name, mimeType: data.type || 'application/octet-stream', totalSize: data.size, chunkSize, provider: options.provider, versionOf: options.versionOf, tags: options.tags },
                    signal: options.signal,
                })
            ).data;
            uploadId = init.uploadId;
            totalChunks = init.totalChunks;
        }
        options.onSession?.(uploadId);
        const size = Math.max(1, chunkSize);
        let loaded = 0;
        for (const n of have) loaded += Math.min(size, data.size - n * size);
        const report = () => options.onProgress?.({ loaded, total: data.size, percent: Math.min(100, Math.round((loaded / data.size) * 100)), chunksDone: have.size, chunksTotal: totalChunks });
        report();

        const pending = Array.from({ length: totalChunks }, (_, i) => i).filter((i) => !have.has(i));
        const sendChunk = async (n: number): Promise<void> => {
            const blob = data.slice(n * size, Math.min(data.size, (n + 1) * size));
            const checksum = await sha256Hex(await blob.arrayBuffer());
            for (let attempt = 1; ; attempt++) {
                try {
                    const form = new FormData();
                    form.append('chunkNumber', String(n));
                    form.append('checksum', checksum);
                    form.append('chunk', blob, 'chunk');
                    await this.request('PUT', `/upload/chunked/${uploadId}`, { form, signal: options.signal });
                    break;
                } catch (e) {
                    const retriable = e instanceof FileCloudError ? e.status === 0 || e.status >= 500 || e.code === 'checksum_mismatch' : true;
                    if (!retriable || attempt >= 3 || options.signal?.aborted) throw e;
                    await new Promise((r) => setTimeout(r, 400 * attempt));
                }
            }
            have.add(n);
            loaded += blob.size;
            report();
        };
        const lanes = Math.max(1, options.concurrency ?? 3);
        await Promise.all(
            Array.from({ length: lanes }, async () => {
                for (let n = pending.shift(); n !== undefined; n = pending.shift()) await sendChunk(n);
            })
        );
        return (await this.request<{ data: FileInfo }>('POST', `/upload/chunked/${uploadId}/complete`, { signal: options.signal })).data;
    }

    /** Unfinished resumable uploads (to offer "resume"). */
    async unfinishedUploads(): Promise<{ uploadId: string; originalName: string; progress: number; status: string; totalSize: number; expiresAt: string }[]> {
        return (await this.request<{ data: never[] }>('GET', '/upload/chunked')).data;
    }

    cancelUpload(uploadId: string): Promise<Json> {
        return this.request('DELETE', `/upload/chunked/${uploadId}`);
    }

    /** The bytes go straight from the browser to the storage provider; the server checks the file when you confirm. */
    async uploadDirect(data: Blob, name: string, options: UploadOptions = {}): Promise<FileInfo> {
        const intent = await this.request<{ url: string; headers: Record<string, string>; method: string; uploadId: string }>('POST', '/files/presigned-url', { json: { filename: name, contentType: data.type || 'application/octet-stream', size: data.size, provider: options.provider } });
        const put = await this.fetchImpl(intent.url, { method: intent.method, headers: intent.headers, body: data, signal: options.signal });
        if (!put.ok) throw new FileCloudError(`The storage provider refused the upload (${put.status})`, put.status, 'provider_refused');
        options.onProgress?.({ loaded: data.size, total: data.size, percent: 100 });
        return (await this.request<{ data: FileInfo }>('POST', '/files/confirm-upload', { json: { uploadId: intent.uploadId } })).data;
    }

    /** A short-lived URL for the content (`inline` for showing it in the page without counting a download). */
    async downloadUrl(id: string, options: { version?: number; variant?: string; inline?: boolean } = {}): Promise<{ url: string; filename: string; mimetype?: string; expiresIn: number }> {
        return this.request('GET', `/files/${id}/download${q({ version: options.version, variant: options.variant, inline: options.inline ? '1' : undefined })}`);
    }

    async download(id: string, options: { version?: number } = {}): Promise<ArrayBuffer> {
        const { url } = await this.downloadUrl(id, options);
        const res = await this.fetchImpl(url);
        if (!res.ok) throw new FileCloudError(`Download failed (${res.status})`, res.status);
        return res.arrayBuffer();
    }

    delete(id: string): Promise<Json> {
        return this.request('DELETE', `/files/${id}`);
    }

    trash(id: string): Promise<Json> {
        return this.request('POST', `/files/${id}/trash`);
    }

    async restore(id: string): Promise<FileInfo> {
        return (await this.request<{ data: FileInfo }>('POST', `/files/${id}/restore`)).data;
    }

    async listTrash(): Promise<Page<FileInfo> & { retentionDays: number }> {
        return (await this.request<{ data: Page<FileInfo> & { retentionDays: number } }>('GET', '/files/trash')).data;
    }

    emptyTrash(): Promise<Json> {
        return this.request('DELETE', '/files/trash');
    }

    async stats(): Promise<{ totalFiles: number; totalSize: number; trashedFiles: number; storageUsed: number; storageLimit: number; categoryBreakdown: { category: string; count: number; size: number }[] }> {
        return (await this.request<{ data: never }>('GET', '/files/stats')).data;
    }

    async capabilities(): Promise<{ providers: string[]; defaultProvider: string; maxFileSize: number; maxChunkSize: number; chunkedUploads: boolean; maxFileVersions: number; trashRetentionDays: number; encryption: { available: boolean; forced: boolean }; virusScanning: boolean; allowedTypes: string[] }> {
        return (await this.request<{ data: never }>('GET', '/files/capabilities')).data;
    }

    activity(id: string): Promise<{ data: { id: string; action: string; actor: { id: string; name?: string } | null; createdAt: string; details?: Json }[] }> {
        return this.request('GET', `/files/${id}/activity`);
    }

    /* ------------------------------------------------------------ versions */

    versions(id: string): Promise<{ data: { maxVersions: number; versions: { id: string; versionNumber: number; size: number; uploadedAt: string; current: boolean; reason?: string }[] } }> {
        return this.request('GET', `/files/${id}/versions`);
    }

    async uploadVersion(id: string, data: Blob, name: string, reason?: string, options: UploadOptions = {}): Promise<FileInfo> {
        const form = new FormData();
        if (reason) form.append('reason', reason);
        form.append('file', data, name);
        return (await this.send<{ data: FileInfo }>('POST', `/files/${id}/versions`, form, options)).data;
    }

    async restoreVersion(id: string, versionNumber: number): Promise<FileInfo> {
        return (await this.request<{ data: FileInfo }>('POST', `/files/${id}/versions/${versionNumber}/restore`)).data;
    }

    deleteVersion(id: string, versionNumber: number): Promise<Json> {
        return this.request('DELETE', `/files/${id}/versions/${versionNumber}`);
    }

    /* ------------------------------------------------------------- sharing */

    async shares(id: string): Promise<{ userId: string; name: string; email: string; permission: string }[]> {
        return (await this.request<{ data: never[] }>('GET', `/files/${id}/shares`)).data;
    }

    async share(id: string, email: string, permission: 'read' | 'write' | 'admin' = 'read') {
        return (await this.request<{ data: { userId: string; name: string; email: string; permission: string }[] }>('POST', `/files/${id}/shares`, { json: { email, permission } })).data;
    }

    async unshare(id: string, userId: string) {
        return (await this.request<{ data: { userId: string }[] }>('DELETE', `/files/${id}/shares/${userId}`)).data;
    }

    async links(id: string): Promise<Json[]> {
        return (await this.request<{ data: Json[] }>('GET', `/files/${id}/links`)).data;
    }

    /** The link's token and URL are only returned here, once. */
    async createLink(id: string, options: { expiresInHours?: number; password?: string; maxDownloads?: number; permission?: 'view' | 'download'; label?: string } = {}): Promise<{ id: string; token: string; url: string } & Json> {
        return (await this.request<{ data: { id: string; token: string; url: string } }>('POST', `/files/${id}/links`, { json: options })).data;
    }

    revokeLink(id: string, linkId: string): Promise<Json> {
        return this.request('DELETE', `/files/${id}/links/${linkId}`);
    }

    /** What a share link points to (no sign-in needed). */
    async describeLink(token: string) {
        return (await this.request<{ data: { name: string; size: number; mimetype: string; category: string; sharedBy?: string; requiresPassword: boolean; permission: 'view' | 'download'; expiresAt?: string; remainingDownloads?: number } }>('GET', `/shared/${token}`, { auth: false })).data;
    }

    openLink(token: string, password?: string, inline = false): Promise<{ url: string; name: string; expiresIn: number }> {
        return this.request('POST', `/shared/${token}/${inline ? 'preview' : 'download'}`, { json: { password, inline }, auth: false });
    }

    /* -------------------------------------------------------------- images */

    imageResize(fileId: string, width: number, height: number, fit = 'cover', quality = 90) {
        return this.request<{ data: Json }>('POST', '/images/resize', { json: { fileId, width, height, fit, quality } });
    }
    imageThumbnail(fileId: string, width?: number, height?: number) {
        return this.request<{ data: Json }>('POST', '/images/thumbnail', { json: { fileId, width, height } });
    }
    imageConvert(fileId: string, format: string, quality = 90) {
        return this.request<{ data: Json }>('POST', '/images/convert', { json: { fileId, format, quality } });
    }
    imageCompress(fileId: string, quality = 80, format = 'jpeg') {
        return this.request<{ data: Json }>('POST', '/images/compress', { json: { fileId, quality, format } });
    }
    imageAutoOrient(fileId: string) {
        return this.request<{ data: FileInfo }>('POST', '/images/auto-orient', { json: { fileId } });
    }
    imageMetadata(fileId: string) {
        return this.request<{ data: Json }>('GET', `/images/${fileId}/metadata`);
    }
    deleteVariant(fileId: string, variantId: string) {
        return this.request('DELETE', `/images/${fileId}/variants/${variantId}`);
    }

    /* ----------------------------------------------- analytics, integrations */

    analytics(): Promise<{ data: Json }> {
        return this.request('GET', '/analytics/dashboard');
    }

    integrations(): Promise<{ integrations: Record<string, { configured: boolean; status: string; lastError?: string; lastUsedAt?: string }> }> {
        return this.request('GET', '/integrations');
    }
    connectIntegration(type: 'slack' | 'dropbox' | 'google-drive', config: { webhookUrl?: string; accessToken?: string; folderId?: string }) {
        return this.request('PUT', `/integrations/${type}`, { json: config });
    }
    disconnectIntegration(type: 'slack' | 'dropbox' | 'google-drive') {
        return this.request('DELETE', `/integrations/${type}`);
    }
    exportTo(type: 'slack' | 'dropbox' | 'google-drive', fileId: string, extra: { message?: string; path?: string; folderId?: string } = {}) {
        return this.request<{ data?: Json }>('POST', `/integrations/${type}`, { json: { fileId, ...extra } });
    }
    webhooks() {
        return this.request<{ data: { id: string; url: string; events: string[]; isActive: boolean; description?: string; failureCount: number }[]; events: string[] }>('GET', '/integrations/webhooks');
    }
    createWebhook(url: string, events: string[] = ['*'], description?: string) {
        return this.request<{ data: { id: string; secret: string } & Json }>('POST', '/integrations/webhooks', { json: { url, events, description } });
    }
    updateWebhook(id: string, patch: Json) {
        return this.request('PATCH', `/integrations/webhooks/${id}`, { json: patch });
    }
    deleteWebhook(id: string) {
        return this.request('DELETE', `/integrations/webhooks/${id}`);
    }
    testWebhook(id: string) {
        return this.request<{ data: { status: string; statusCode?: number; error?: string } }>('POST', `/integrations/webhooks/${id}/test`);
    }
    webhookDeliveries(id: string) {
        return this.request<{ data: { _id: string; event: string; status: string; attempt: number; statusCode?: number; error?: string; createdAt: string }[] }>('GET', `/integrations/webhooks/${id}/deliveries`);
    }

    /* --------------------------------------------------------------- admin */

    admin = {
        users: (params: { search?: string; page?: number; limit?: number } = {}) => this.request<{ data: { users: (UserInfo & { isActive: boolean })[]; pagination: Page<never>['pagination'] } }>('GET', `/admin/users${q(params)}`),
        updateUser: (id: string, patch: { isActive?: boolean; role?: string; storageLimit?: number }) => this.request('PATCH', `/admin/users/${id}`, { json: patch }),
        deleteUser: (id: string) => this.request('DELETE', `/admin/users/${id}`),
        stats: () => this.request<{ data: Json }>('GET', '/admin/stats'),
        system: () => this.request<{ data: { providers: { name: string; configured: boolean; healthy?: boolean; isDefault: boolean; bucket?: string; error?: string }[]; redis: boolean | null; virusScanner: boolean | null } }>('GET', '/admin/system'),
        runJanitor: () => this.request<{ data: Json }>('POST', '/admin/janitor/run'),
    };
}

export default FileCloudSDK;
