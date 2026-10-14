import sharp from 'sharp';
import logger from '../config/logger';
import AppError from './appError';

export const IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'tiff'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Decoding is limited so a tiny file that expands to gigapixels (decompression bomb) cannot exhaust memory. */
const MAX_PIXELS = 100_000_000;
const open = (input: Buffer | string) => sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' });

export interface Processed {
    buffer: Buffer;
    metadata: sharp.Metadata;
    mimetype: string;
}

const MIME: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', tiff: 'image/tiff' };
export const mimeForFormat = (format: string): string => MIME[format.toLowerCase()] ?? 'application/octet-stream';
export const extensionForFormat = (format: string): string => (format.toLowerCase() === 'jpeg' ? 'jpg' : format.toLowerCase());

const normalizeFormat = (f: string): Exclude<ImageFormat, 'jpg'> => {
    const v = f.toLowerCase();
    if (!(IMAGE_FORMATS as readonly string[]).includes(v)) throw new AppError(`Unsupported image format: ${f}`, 400);
    return (v === 'jpg' ? 'jpeg' : v) as Exclude<ImageFormat, 'jpg'>;
};

async function finish(pipeline: sharp.Sharp, what: string): Promise<Processed> {
    try {
        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        const metadata = await sharp(data).metadata();
        return { buffer: data, metadata: { ...metadata, width: info.width, height: info.height }, mimetype: mimeForFormat(info.format) };
    } catch (error) {
        logger.error(`Image ${what} error`, { err: (error as Error).message });
        throw new AppError(`Failed to ${what} image`, 422, 'image_processing_failed');
    }
}

class ImageProcessor {
    readonly supportedFormats = IMAGE_FORMATS;
    readonly defaultQuality = 90;

    /** Resizes keeping the image's own format; `quality` applies to lossy formats. */
    async resize(input: Buffer, options: { width?: number; height?: number; fit?: keyof sharp.FitEnum; position?: string; quality?: number; withoutEnlargement?: boolean } = {}): Promise<Processed> {
        const { width, height, fit = 'cover', position = 'center', quality = this.defaultQuality, withoutEnlargement = true } = options;
        const format = normalizeFormat((await open(input).metadata().catch(() => ({ format: undefined }))).format ?? 'jpeg');
        const pipeline = open(input).rotate(); // honour EXIF orientation, then drop the tag
        if (width || height) pipeline.resize(width, height, { fit, position, withoutEnlargement, background: { r: 255, g: 255, b: 255, alpha: 1 } });
        return finish(pipeline.toFormat(format, { quality }), 'resize');
    }

    thumbnail(input: Buffer, options: { width?: number; height?: number; quality?: number; format?: string } = {}): Promise<Processed> {
        const { width = 200, height = 200, quality = 80, format = 'jpeg' } = options;
        return finish(open(input).rotate().resize(width, height, { fit: 'cover', position: 'center' }).toFormat(normalizeFormat(format), { quality }), 'generate a thumbnail for');
    }

    convert(input: Buffer, format: string, options: { quality?: number } = {}): Promise<Processed> {
        return finish(open(input).rotate().toFormat(normalizeFormat(format), { quality: options.quality ?? this.defaultQuality }), 'convert');
    }

    compress(input: Buffer, options: { quality?: number; format?: string } = {}): Promise<Processed> {
        const { quality = 80, format = 'jpeg' } = options;
        return finish(open(input).rotate().toFormat(normalizeFormat(format), { quality }), 'compress');
    }

    async getMetadata(input: Buffer): Promise<Record<string, unknown>> {
        try {
            const m = await open(input).metadata();
            return { width: m.width, height: m.height, format: m.format, size: input.length, density: m.density, hasAlpha: m.hasAlpha, orientation: m.orientation, channels: m.channels, space: m.space };
        } catch {
            throw new AppError('Failed to read image metadata', 422, 'image_processing_failed');
        }
    }

    /** Applies the EXIF rotation to the pixels (and removes the tag), keeping the image format. */
    async autoOrient(input: Buffer): Promise<Processed> {
        const m = await open(input).metadata();
        return finish(open(input).rotate().toFormat(normalizeFormat(m.format ?? 'jpeg')), 'auto-orient');
    }

    crop(input: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<Processed> {
        return finish(open(input).extract(region), 'crop');
    }

    async validate(input: Buffer): Promise<{ valid: boolean; error?: string; metadata?: sharp.Metadata }> {
        try {
            const metadata = await open(input).metadata();
            if (!metadata.width || !metadata.height) return { valid: false, error: 'Invalid image dimensions' };
            if (metadata.width > 10000 || metadata.height > 10000) return { valid: false, error: 'Image dimensions too large' };
            return { valid: true, metadata };
        } catch {
            return { valid: false, error: 'Invalid image file' };
        }
    }
}

export default new ImageProcessor();
