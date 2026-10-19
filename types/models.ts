import type { HydratedDocument, Types } from 'mongoose';

export const PROVIDER_NAMES = ['local', 's3', 'minio', 'digitalocean', 'wasabi', 'r2', 'b2', 'gcs', 'azure'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type FileCategory = 'image' | 'video' | 'document' | 'audio' | 'other';
export type Permission = 'read' | 'write' | 'admin';

export interface EncryptionInfo {
    iv: string;
    authTag: string;
}

/** End-to-end encryption parameters of content the client encrypted (see utils/clientEncryption.ts). Not secret. */
export interface ClientEncryption {
    scheme: 'pbkdf2-aes256gcm-v1';
    /** base64, 16 bytes */
    salt: string;
    /** base64, 8 bytes */
    noncePrefix: string;
    iterations: number;
    segmentSize: number;
    /** Type of the plain content. */
    mimetype: string;
    /** Size of the plain content. */
    size: number;
}

export interface IUser {
    name: string;
    email: string;
    password: string;
    role: 'user' | 'admin';
    /** Bumped on password change / sign-out everywhere: older tokens stop working. */
    tokenVersion: number;
    storageUsed: number;
    storageLimit: number;
    fileCount: number;
    isActive: boolean;
    lastLogin?: Date;
    preferences: {
        defaultStorage?: ProviderName;
        autoProcessImages: boolean;
        enableVirusScan: boolean;
        encryptFiles: boolean;
    };
    createdAt: Date;
    updatedAt: Date;
}
export interface IUserMethods {
    comparePassword(candidate: string): Promise<boolean>;
    hasStorageSpace(fileSize: number): boolean;
    updateStorage(fileSize: number, operation?: 'add' | 'subtract'): Promise<unknown>;
}
export type UserDoc = HydratedDocument<IUser, IUserMethods>;

export interface IFileVariant {
    _id?: Types.ObjectId;
    type: 'thumbnail' | 'resized' | 'converted' | 'original';
    key: string;
    size: number;
    dimensions?: { width?: number; height?: number };
    format?: string;
    location?: string;
    mimetype?: string;
    isEncrypted?: boolean;
    encryptionInfo?: EncryptionInfo;
}

/** A previous version of a file's content (the current version always lives in the top-level fields). */
export interface IFileVersion {
    _id?: Types.ObjectId;
    versionNumber: number;
    key: string;
    size: number;
    originalName?: string;
    mimetype?: string;
    etag?: string;
    checksum?: string;
    uploadedAt: Date;
    uploadedBy?: Types.ObjectId;
    reason?: string;
    isEncrypted?: boolean;
    encryptionInfo?: EncryptionInfo;
    clientEncryption?: ClientEncryption | null;
}

export interface IFileShare {
    _id?: Types.ObjectId;
    user: Types.ObjectId;
    permission: Permission;
    sharedAt: Date;
}

export interface IFile {
    filename: string;
    originalName: string;
    mimetype: string;
    size: number;
    key: string;
    location: string;
    bucket?: string;
    storageType: ProviderName;
    category: FileCategory;
    isPublic: boolean;
    uploadedBy: Types.ObjectId;
    description?: string;
    metadata?: { width?: number; height?: number; duration?: number; compressed?: boolean; format?: string };
    variants: Types.DocumentArray<IFileVariant>;
    versions: Types.DocumentArray<IFileVersion>;
    currentVersion: number;
    etag?: string;
    checksum?: string;
    isEncrypted: boolean;
    encryptionInfo?: EncryptionInfo;
    /** Set when the client encrypted the content end to end (the server holds ciphertext only). */
    clientEncryption?: ClientEncryption | null;
    virusScanned: boolean;
    virusStatus?: 'clean' | 'infected' | 'pending' | 'error';
    downloadCount: number;
    lastAccessedAt?: Date;
    tags: string[];
    accessControl: 'private' | 'public' | 'shared';
    sharedWith: Types.DocumentArray<IFileShare>;
    expiresAt?: Date;
    /** Who last replaced the content, and when (the history keeps the earlier ones). */
    modifiedBy?: Types.ObjectId;
    contentUpdatedAt?: Date;
    deletedAt?: Date | null;
    deletedBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
export interface IFileMethods {
    incrementDownloads(): Promise<unknown>;
    addVariant(variant: Omit<IFileVariant, '_id'>): Promise<unknown>;
    getVariant(type: IFileVariant['type']): IFileVariant | undefined;
    getLatestVersion(): IFileVersion | undefined;
    /** Every byte this file keeps in storage: current content, older versions and generated variants. */
    storedBytes(): number;
}
export type FileDoc = HydratedDocument<IFile, IFileMethods>;

export type UploadStatus = 'pending' | 'uploading' | 'paused' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface IUploadSession {
    user: Types.ObjectId;
    filename: string;
    originalName: string;
    mimeType: string;
    totalSize: number;
    chunkSize: number;
    totalChunks: number;
    uploadedChunks: number[];
    chunkKeys: { chunkNumber: number; key: string; size: number }[];
    status: UploadStatus;
    fileId?: Types.ObjectId;
    /** Target file when the upload creates a new version of an existing file. */
    versionOf?: Types.ObjectId;
    uploadId: string;
    storageType?: ProviderName;
    /** Quota reserved when the session started (released on cancel / expiry). */
    reservedBytes: number;
    /** Whose quota pays: the uploader, or the file owner when the upload is a new version of someone's file. */
    quotaUser?: Types.ObjectId;
    expiresAt: Date;
    finishedAt?: Date;
    metadata?: { width?: number; height?: number; duration?: number };
    error?: string;
    /** Tags for the file the session creates. */
    tags?: string[];
    /** Set when the chunks are end-to-end encrypted content. */
    clientEncryption?: ClientEncryption | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface IUploadSessionMethods {
    isComplete(): boolean;
    getMissingChunks(): number[];
    getProgress(): number;
    addChunk(chunkNumber: number, key: string, size: number): Promise<unknown>;
}
export type UploadSessionDoc = HydratedDocument<IUploadSession, IUploadSessionMethods>;

export interface IShareLink {
    file: Types.ObjectId;
    createdBy: Types.ObjectId;
    /** SHA-256 of the token; the token itself is only shown once. */
    tokenHash: string;
    label?: string;
    permission: 'view' | 'download';
    passwordHash?: string;
    expiresAt?: Date;
    maxDownloads?: number;
    downloadCount: number;
    accessCount: number;
    lastAccessedAt?: Date;
    revokedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export type ShareLinkDoc = HydratedDocument<IShareLink>;

export interface IPendingUpload {
    user: Types.ObjectId;
    key: string;
    storageType: ProviderName;
    filename: string;
    mimetype: string;
    size: number;
    status: 'pending' | 'confirmed' | 'rejected' | 'expired';
    versionOf?: Types.ObjectId;
    /** Whose quota was reserved (the file owner for a new version). */
    quotaUser?: Types.ObjectId;
    expiresAt: Date;
    createdAt: Date;
}
export type PendingUploadDoc = HydratedDocument<IPendingUpload>;

export type IntegrationType = 'slack' | 'dropbox' | 'googleDrive';
export interface IIntegration {
    user: Types.ObjectId;
    type: IntegrationType;
    /** AES-256-GCM encrypted JSON (webhook URL / access token). Never returned by the API. */
    config: string;
    enabled: boolean;
    lastUsedAt?: Date;
    lastError?: string;
    createdAt: Date;
    updatedAt: Date;
}
export type IntegrationDoc = HydratedDocument<IIntegration>;

export interface IFileActivity {
    file: Types.ObjectId;
    actor?: Types.ObjectId;
    action: string;
    ip?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
    createdAt: Date;
}
export type FileActivityDoc = HydratedDocument<IFileActivity>;
