/** OpenAPI 3 description of the API, built from one table so it cannot drift from the route list in routes/. */
import cfg from './env';

type Auth = 'user' | 'admin' | 'none';
interface Op {
    m: 'get' | 'post' | 'put' | 'patch' | 'delete';
    p: string;
    tag: string;
    summary: string;
    auth?: Auth;
    /** JSON body fields: "name:type!" (! = required) */
    body?: string[];
    /** multipart/form-data fields */
    form?: string[];
    query?: string[];
}

const ops: Op[] = [
    // auth
    { m: 'post', p: '/api/auth/register', tag: 'Auth', summary: 'Create an account', auth: 'none', body: ['name:string!', 'email:string!', 'password:string!'] },
    { m: 'post', p: '/api/auth/login', tag: 'Auth', summary: 'Sign in; returns a bearer token', auth: 'none', body: ['email:string!', 'password:string!'] },
    { m: 'get', p: '/api/auth/me', tag: 'Auth', summary: 'The signed-in user with fresh storage numbers' },
    { m: 'put', p: '/api/auth/profile', tag: 'Auth', summary: 'Change name or preferences (default storage, encryption)', body: ['name:string', 'preferences:object'] },
    { m: 'put', p: '/api/auth/password', tag: 'Auth', summary: 'Change password (signs out other devices)', body: ['currentPassword:string!', 'newPassword:string!'] },
    { m: 'post', p: '/api/auth/logout', tag: 'Auth', summary: 'Sign out this device' },
    { m: 'post', p: '/api/auth/logout-all', tag: 'Auth', summary: 'Sign out every device' },
    { m: 'delete', p: '/api/auth/account', tag: 'Auth', summary: 'Deactivate the account', body: ['password:string!'] },
    // files
    { m: 'post', p: '/api/files/upload', tag: 'Files', summary: 'Upload one file', form: ['file:binary!', 'isPublic:boolean', 'tags:string', 'description:string', 'expiresAt:string', 'provider:string'] },
    { m: 'post', p: '/api/files/upload-image', tag: 'Files', summary: 'Upload an image, scaled down to at most 1920x1080', form: ['image:binary!'] },
    { m: 'post', p: '/api/files/upload-multiple', tag: 'Files', summary: 'Upload up to 10 files', form: ['files:binary!'] },
    { m: 'post', p: '/api/files/presigned-url', tag: 'Files', summary: 'Get a URL to upload straight to the storage provider', body: ['filename:string!', 'contentType:string!', 'size:integer!', 'provider:string', 'versionOf:string'] },
    { m: 'post', p: '/api/files/confirm-upload', tag: 'Files', summary: 'Finish a direct upload (the file is checked and recorded)', body: ['uploadId:string!'] },
    { m: 'get', p: '/api/files', tag: 'Files', summary: 'List files (mine, shared with me, all for admins)', query: ['scope', 'page', 'limit', 'category', 'tag', 'search', 'sort', 'order'] },
    { m: 'get', p: '/api/files/stats', tag: 'Files', summary: 'Totals by category and quota' },
    { m: 'get', p: '/api/files/capabilities', tag: 'Files', summary: 'Configured providers, size limits, encryption and scanning' },
    { m: 'get', p: '/api/files/trash', tag: 'Files', summary: 'Files in the trash' },
    { m: 'delete', p: '/api/files/trash', tag: 'Files', summary: 'Empty the trash for good' },
    { m: 'get', p: '/api/files/{id}', tag: 'Files', summary: 'One file' },
    { m: 'patch', p: '/api/files/{id}', tag: 'Files', summary: 'Rename, tag, describe, set visibility or expiry', body: ['name:string', 'tags:array', 'description:string', 'isPublic:boolean', 'accessControl:string', 'expiresAt:string'] },
    { m: 'delete', p: '/api/files/{id}', tag: 'Files', summary: 'Delete for good (content, versions, thumbnails, links)' },
    { m: 'get', p: '/api/files/{id}/download', tag: 'Files', summary: 'A short-lived download URL', query: ['version', 'variant', 'inline'] },
    { m: 'get', p: '/api/files/{id}/stream', tag: 'Files', summary: 'Stream the file (Range requests supported)', query: ['version', 'variant'] },
    { m: 'get', p: '/api/files/{id}/thumbnail', tag: 'Files', summary: 'The thumbnail of an image' },
    { m: 'get', p: '/api/files/{id}/activity', tag: 'Files', summary: 'Who did what to the file' },
    { m: 'post', p: '/api/files/{id}/trash', tag: 'Files', summary: 'Move to the trash' },
    { m: 'post', p: '/api/files/{id}/restore', tag: 'Files', summary: 'Bring back from the trash' },
    { m: 'get', p: '/api/files/{id}/versions', tag: 'Versions', summary: 'Version history' },
    { m: 'post', p: '/api/files/{id}/versions', tag: 'Versions', summary: 'Upload new content as the next version', form: ['file:binary!', 'reason:string'] },
    { m: 'post', p: '/api/files/{id}/versions/{version}/restore', tag: 'Versions', summary: 'Make an older version current' },
    { m: 'delete', p: '/api/files/{id}/versions/{version}', tag: 'Versions', summary: 'Delete one old version' },
    { m: 'get', p: '/api/files/{id}/shares', tag: 'Sharing', summary: 'People the file is shared with' },
    { m: 'post', p: '/api/files/{id}/shares', tag: 'Sharing', summary: 'Share with a user by e-mail', body: ['email:string!', 'permission:string'] },
    { m: 'delete', p: '/api/files/{id}/shares/{userId}', tag: 'Sharing', summary: 'Stop sharing with a user' },
    { m: 'get', p: '/api/files/{id}/links', tag: 'Sharing', summary: 'Share links of the file' },
    { m: 'post', p: '/api/files/{id}/links', tag: 'Sharing', summary: 'Create a share link (token shown once)', body: ['expiresInHours:integer', 'password:string', 'maxDownloads:integer', 'permission:string', 'label:string'] },
    { m: 'delete', p: '/api/files/{id}/links/{linkId}', tag: 'Sharing', summary: 'Revoke a share link' },
    { m: 'get', p: '/api/shared/{token}', tag: 'Public links', summary: 'What a share link points to', auth: 'none' },
    { m: 'post', p: '/api/shared/{token}/download', tag: 'Public links', summary: 'Get a download URL for a share link', auth: 'none', body: ['password:string', 'inline:boolean'] },
    { m: 'get', p: '/api/content/{token}', tag: 'Public links', summary: 'Signed content link (encrypted files stream through here)', auth: 'none' },
    // chunked
    { m: 'post', p: '/api/upload/chunked', tag: 'Resumable uploads', summary: 'Start a resumable upload (space is reserved)', body: ['originalName:string!', 'mimeType:string!', 'totalSize:integer!', 'chunkSize:integer', 'provider:string', 'versionOf:string'] },
    { m: 'get', p: '/api/upload/chunked', tag: 'Resumable uploads', summary: 'My unfinished uploads' },
    { m: 'put', p: '/api/upload/chunked/{id}', tag: 'Resumable uploads', summary: 'Send one chunk', form: ['chunk:binary!', 'chunkNumber:integer!', 'checksum:string'] },
    { m: 'post', p: '/api/upload/chunked/{id}/complete', tag: 'Resumable uploads', summary: 'Assemble the chunks into the file' },
    { m: 'post', p: '/api/upload/chunked/{id}/pause', tag: 'Resumable uploads', summary: 'Pause' },
    { m: 'post', p: '/api/upload/chunked/{id}/resume', tag: 'Resumable uploads', summary: 'Resume: which chunks are missing' },
    { m: 'get', p: '/api/upload/chunked/{id}/status', tag: 'Resumable uploads', summary: 'Progress' },
    { m: 'delete', p: '/api/upload/chunked/{id}', tag: 'Resumable uploads', summary: 'Cancel and delete what was uploaded' },
    // images
    { m: 'post', p: '/api/images/resize', tag: 'Images', summary: 'Resize into a new variant', body: ['fileId:string!', 'width:integer!', 'height:integer!', 'fit:string', 'quality:integer'] },
    { m: 'post', p: '/api/images/thumbnail', tag: 'Images', summary: 'Thumbnail', body: ['fileId:string!', 'width:integer', 'height:integer', 'quality:integer'] },
    { m: 'post', p: '/api/images/convert', tag: 'Images', summary: 'Convert format', body: ['fileId:string!', 'format:string!', 'quality:integer'] },
    { m: 'post', p: '/api/images/compress', tag: 'Images', summary: 'Compress', body: ['fileId:string!', 'quality:integer', 'format:string'] },
    { m: 'post', p: '/api/images/auto-orient', tag: 'Images', summary: 'Fix EXIF rotation (new version)', body: ['fileId:string!'] },
    { m: 'get', p: '/api/images/{id}/variants', tag: 'Images', summary: 'Original and variants' },
    { m: 'get', p: '/api/images/{id}/metadata', tag: 'Images', summary: 'Width, height, format, orientation' },
    { m: 'delete', p: '/api/images/{id}/variants/{variantId}', tag: 'Images', summary: 'Delete a variant' },
    // analytics
    { m: 'get', p: '/api/analytics/dashboard', tag: 'Analytics', summary: 'My usage' },
    { m: 'get', p: '/api/analytics/storage', tag: 'Analytics', summary: 'Storage analytics (scope=all for admins)', query: ['scope'] },
    // integrations
    { m: 'get', p: '/api/integrations', tag: 'Integrations', summary: 'Which integrations are connected' },
    { m: 'put', p: '/api/integrations/{type}', tag: 'Integrations', summary: 'Connect slack | dropbox | google-drive', body: ['webhookUrl:string', 'accessToken:string', 'folderId:string'] },
    { m: 'delete', p: '/api/integrations/{type}', tag: 'Integrations', summary: 'Disconnect' },
    { m: 'post', p: '/api/integrations/slack', tag: 'Integrations', summary: 'Post to Slack', body: ['fileId:string', 'message:string'] },
    { m: 'post', p: '/api/integrations/dropbox', tag: 'Integrations', summary: 'Copy a file to Dropbox', body: ['fileId:string!', 'path:string'] },
    { m: 'post', p: '/api/integrations/google-drive', tag: 'Integrations', summary: 'Copy a file to Google Drive', body: ['fileId:string!', 'folderId:string'] },
    { m: 'get', p: '/api/integrations/webhooks', tag: 'Webhooks', summary: 'My webhooks' },
    { m: 'post', p: '/api/integrations/webhooks', tag: 'Webhooks', summary: 'Create a webhook (signing secret shown once)', body: ['url:string!', 'events:array', 'description:string'] },
    { m: 'patch', p: '/api/integrations/webhooks/{id}', tag: 'Webhooks', summary: 'Change a webhook', body: ['url:string', 'events:array', 'description:string', 'isActive:boolean'] },
    { m: 'delete', p: '/api/integrations/webhooks/{id}', tag: 'Webhooks', summary: 'Delete a webhook' },
    { m: 'post', p: '/api/integrations/webhooks/{id}/test', tag: 'Webhooks', summary: 'Send a test event' },
    { m: 'post', p: '/api/integrations/webhooks/{id}/rotate-secret', tag: 'Webhooks', summary: 'New signing secret' },
    { m: 'get', p: '/api/integrations/webhooks/{id}/deliveries', tag: 'Webhooks', summary: 'Recent deliveries' },
    // admin
    { m: 'get', p: '/api/admin/users', tag: 'Admin', summary: 'Users', auth: 'admin', query: ['search', 'page', 'limit'] },
    { m: 'patch', p: '/api/admin/users/{id}', tag: 'Admin', summary: 'Lock, change role or storage limit', auth: 'admin', body: ['isActive:boolean', 'role:string', 'storageLimit:integer'] },
    { m: 'delete', p: '/api/admin/users/{id}', tag: 'Admin', summary: 'Delete a user and all their files', auth: 'admin' },
    { m: 'post', p: '/api/admin/users/{id}/recalculate-quota', tag: 'Admin', summary: 'Recompute a user\'s usage from their files', auth: 'admin' },
    { m: 'get', p: '/api/admin/stats', tag: 'Admin', summary: 'Service-wide numbers', auth: 'admin' },
    { m: 'get', p: '/api/admin/system', tag: 'Admin', summary: 'Providers, Redis and scanner health', auth: 'admin' },
    { m: 'post', p: '/api/admin/janitor/run', tag: 'Admin', summary: 'Run housekeeping now', auth: 'admin' },
    { m: 'get', p: '/api/storage/providers', tag: 'Storage providers', summary: 'Which providers are configured', auth: 'admin' },
    { m: 'get', p: '/api/storage/providers/{provider}/buckets', tag: 'Storage providers', summary: 'List buckets / containers', auth: 'admin' },
    { m: 'post', p: '/api/storage/providers/{provider}/buckets', tag: 'Storage providers', summary: 'Create a bucket', auth: 'admin', body: ['name:string!'] },
    { m: 'delete', p: '/api/storage/providers/{provider}/buckets/{bucket}', tag: 'Storage providers', summary: 'Delete a bucket', auth: 'admin' },
    { m: 'get', p: '/api/storage/providers/{provider}/buckets/{bucket}/objects', tag: 'Storage providers', summary: 'List objects', auth: 'admin', query: ['prefix', 'limit', 'cursor'] },
    { m: 'get', p: '/api/storage/providers/{provider}/buckets/{bucket}/presign', tag: 'Storage providers', summary: 'Presigned download URL', auth: 'admin', query: ['key', 'expiresIn'] },
];

const typeOf = (t: string): Record<string, unknown> => (t === 'binary' ? { type: 'string', format: 'binary' } : t === 'array' ? { type: 'array', items: { type: 'string' } } : { type: t });

function schemaOf(fields: string[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of fields) {
        const [name, rest] = f.split(':') as [string, string];
        const req = rest.endsWith('!');
        properties[name] = typeOf(req ? rest.slice(0, -1) : rest);
        if (req) required.push(name);
    }
    return { type: 'object', properties, ...(required.length && { required }) };
}

const paths: Record<string, Record<string, unknown>> = {};
for (const o of ops) {
    const params = [...[...o.p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })), ...(o.query ?? []).map((q) => ({ name: q, in: 'query', schema: { type: 'string' } }))];
    (paths[o.p] ??= {})[o.m] = {
        tags: [o.tag],
        summary: o.summary,
        ...(o.auth !== 'none' && { security: [{ bearerAuth: [] }] }),
        ...(o.auth === 'admin' && { description: 'Administrators only.' }),
        ...(params.length && { parameters: params }),
        ...(o.body && { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(o.body) } } } }),
        ...(o.form && { requestBody: { required: true, content: { 'multipart/form-data': { schema: schemaOf(o.form) } } } }),
        responses: { 200: { description: 'OK' }, 400: { description: 'Invalid input' }, 401: { description: 'Not signed in' }, 403: { description: 'Not allowed' }, 404: { description: 'Not found' }, 413: { description: 'Too large / quota exceeded' }, 429: { description: 'Rate limited' } },
    };
}

const spec = {
    openapi: '3.0.3',
    info: {
        title: 'Cloud Storage Service API',
        version: '2.0.0',
        description:
            'File storage on local disk, S3, MinIO, DigitalOcean Spaces, Wasabi, Cloudflare R2, Backblaze B2, Google Cloud Storage or Azure Blob Storage. ' +
            'Sign in with POST /api/auth/login and send `Authorization: Bearer <token>`. Errors look like `{ "success": false, "message": "...", "code": "...", "errors": [...] }`.',
    },
    servers: [{ url: cfg.PUBLIC_URL, description: cfg.isProd ? 'This server' : 'Development server' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
};

export default spec;
