import mongoose, { type HydratedDocument, Schema, type Types } from 'mongoose';

export interface IWebhookDelivery {
    webhook: Types.ObjectId;
    /** Same id on every attempt of one delivery (sent as X-Webhook-ID). */
    deliveryId: string;
    event: string;
    payload: Record<string, unknown>;
    attempt: number;
    status: 'pending' | 'success' | 'failed';
    statusCode?: number;
    responseTimeMs?: number;
    error?: string;
    nextRetryAt?: Date;
    createdAt: Date;
}

export type WebhookDeliveryDoc = HydratedDocument<IWebhookDelivery>;

const schema = new Schema<IWebhookDelivery>(
    {
        webhook: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
        deliveryId: { type: String, required: true, index: true },
        event: { type: String, required: true },
        payload: { type: Schema.Types.Mixed, required: true },
        attempt: { type: Number, default: 1 },
        status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
        statusCode: Number,
        responseTimeMs: Number,
        error: String,
        nextRetryAt: Date,
        createdAt: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

// delivery history is kept for 30 days
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export default mongoose.model<IWebhookDelivery>('WebhookDelivery', schema);
