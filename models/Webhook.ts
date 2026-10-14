import mongoose, { type HydratedDocument, Schema, type Types } from 'mongoose';

/** Events the service emits. A webhook subscribes to some of them, or to all with `*`. */
export const WEBHOOK_EVENTS = [
    'file.uploaded',
    'file.version_created',
    'file.updated',
    'file.trashed',
    'file.restored',
    'file.deleted',
    'file.shared',
    'file.unshared',
    'file.infected',
    'link.created',
    'link.revoked',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface IWebhook {
    /** The user who registered it; it only receives events about this user's files. */
    userId: Types.ObjectId;
    description?: string;
    events: string[];
    url: string;
    /** AES-256-GCM encrypted signing secret (shown to the owner once, at creation / regeneration). */
    secret: string;
    isActive: boolean;
    /** Consecutive failed deliveries; the webhook is disabled after too many. */
    failureCount: number;
    disabledReason?: string;
    lastDeliveryAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export type WebhookDoc = HydratedDocument<IWebhook>;

const webhookSchema = new Schema<IWebhook>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        description: { type: String, maxlength: 200 },
        events: {
            type: [String],
            required: true,
            validate: { validator: (v: string[]) => v.length > 0 && v.every((e) => e === '*' || (WEBHOOK_EVENTS as readonly string[]).includes(e)), message: 'Unknown webhook event' },
        },
        url: { type: String, required: true, validate: { validator: (v: string) => /^https?:\/\/.+/.test(v), message: 'URL must be a valid HTTP/HTTPS URL' } },
        secret: { type: String, required: true, select: false },
        isActive: { type: Boolean, default: true },
        failureCount: { type: Number, default: 0 },
        disabledReason: String,
        lastDeliveryAt: Date,
        lastSuccessAt: Date,
        lastFailureAt: Date,
    },
    { timestamps: true }
);

webhookSchema.index({ userId: 1 });
webhookSchema.index({ isActive: 1, userId: 1, events: 1 });

export default mongoose.model<IWebhook>('Webhook', webhookSchema);
