const sharp = require('sharp');
const logger = require('../config/logger');

class ImageProcessor {
    constructor() {
        this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'tiff'];
        this.defaultQuality = 90;
    }

    // Resize image
    async resize(buffer, options = {}) {
        const {
            width,
            height,
            fit = 'cover',
            position = 'center',
            background = { r: 255, g: 255, b: 255, alpha: 1 },
            withoutEnlargement = true
        } = options;

        try {
            let pipeline = sharp(buffer);

            if (width || height) {
                pipeline = pipeline.resize(width, height, {
                    fit,
                    position,
                    background,
                    withoutEnlargement
                });
            }

            const processedBuffer = await pipeline.toBuffer();
            const metadata = await sharp(processedBuffer).metadata();

            logger.info('Image resized successfully', {
                originalSize: buffer.length,
                newSize: processedBuffer.length,
                dimensions: `${metadata.width}x${metadata.height}`
            });

            return {
                buffer: processedBuffer,
                metadata
            };
        } catch (error) {
            logger.error('Image resize error:', error);
            throw new Error('Failed to resize image');
        }
    }

    // Generate thumbnail
    async thumbnail(buffer, options = {}) {
        const {
            width = 200,
            height = 200,
            quality = 80,
            format = 'jpeg'
        } = options;

        try {
            const processedBuffer = await sharp(buffer)
                .resize(width, height, {
                    fit: 'cover',
                    position: 'center'
                })
                .toFormat(format, { quality })
                .toBuffer();

            const metadata = await sharp(processedBuffer).metadata();

            logger.info('Thumbnail generated successfully', {
                dimensions: `${metadata.width}x${metadata.height}`,
                size: processedBuffer.length
            });

            return {
                buffer: processedBuffer,
                metadata
            };
        } catch (error) {
            logger.error('Thumbnail generation error:', error);
            throw new Error('Failed to generate thumbnail');
        }
    }

    // Convert image format
    async convert(buffer, format, options = {}) {
        const { quality = 90 } = options;

        if (!this.supportedFormats.includes(format.toLowerCase())) {
            throw new Error(`Unsupported format: ${format}`);
        }

        try {
            const processedBuffer = await sharp(buffer)
                .toFormat(format, { quality })
                .toBuffer();

            const metadata = await sharp(processedBuffer).metadata();

            logger.info('Image converted successfully', {
                from: metadata.format,
                to: format,
                originalSize: buffer.length,
                newSize: processedBuffer.length
            });

            return {
                buffer: processedBuffer,
                metadata
            };
        } catch (error) {
            logger.error('Image conversion error:', error);
            throw new Error('Failed to convert image');
        }
    }

    // Compress image
    async compress(buffer, options = {}) {
        const { quality = 80, format = 'jpeg' } = options;

        try {
            const processedBuffer = await sharp(buffer)
                .toFormat(format, { quality })
                .toBuffer();

            const metadata = await sharp(processedBuffer).metadata();

            logger.info('Image compressed successfully', {
                originalSize: buffer.length,
                newSize: processedBuffer.length,
                compressionRatio: ((1 - processedBuffer.length / buffer.length) * 100).toFixed(2) + '%'
            });

            return {
                buffer: processedBuffer,
                metadata
            };
        } catch (error) {
            logger.error('Image compression error:', error);
            throw new Error('Failed to compress image');
        }
    }

    // Get image metadata
    async getMetadata(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            
            return {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                size: buffer.length,
                density: metadata.density,
                hasAlpha: metadata.hasAlpha,
                orientation: metadata.orientation,
                channels: metadata.channels
            };
        } catch (error) {
            logger.error('Metadata extraction error:', error);
            throw new Error('Failed to extract image metadata');
        }
    }

    // Auto-orient image (fix rotation from EXIF data)
    async autoOrient(buffer) {
        try {
            const processedBuffer = await sharp(buffer)
                .rotate()
                .toBuffer();

            logger.info('Image auto-oriented successfully');
            return processedBuffer;
        } catch (error) {
            logger.error('Auto-orient error:', error);
            throw new Error('Failed to auto-orient image');
        }
    }

    // Crop image
    async crop(buffer, options) {
        const { left, top, width, height } = options;

        try {
            const processedBuffer = await sharp(buffer)
                .extract({ left, top, width, height })
                .toBuffer();

            const metadata = await sharp(processedBuffer).metadata();

            logger.info('Image cropped successfully', {
                dimensions: `${metadata.width}x${metadata.height}`
            });

            return {
                buffer: processedBuffer,
                metadata
            };
        } catch (error) {
            logger.error('Image crop error:', error);
            throw new Error('Failed to crop image');
        }
    }

    // Add watermark
    async watermark(buffer, watermarkBuffer, options = {}) {
        const {
            position = 'bottom-right',
            opacity = 0.5,
            scale = 0.1
        } = options;

        try {
            const mainImage = sharp(buffer);
            const mainMetadata = await mainImage.metadata();
            
            const watermarkImage = sharp(watermarkBuffer);
            const watermarkMetadata = await watermarkImage.metadata();
            
            // Calculate watermark size
            const watermarkWidth = Math.floor(mainMetadata.width * scale);
            const watermarkHeight = Math.floor(watermarkMetadata.height * (watermarkWidth / watermarkMetadata.width));
            
            const resizedWatermark = await watermarkImage
                .resize(watermarkWidth, watermarkHeight)
                .toBuffer();
            
            // Calculate position
            let left, top;
            const padding = 20;
            
            switch (position) {
                case 'top-left':
                    left = padding;
                    top = padding;
                    break;
                case 'top-right':
                    left = mainMetadata.width - watermarkWidth - padding;
                    top = padding;
                    break;
                case 'bottom-left':
                    left = padding;
                    top = mainMetadata.height - watermarkHeight - padding;
                    break;
                case 'bottom-right':
                default:
                    left = mainMetadata.width - watermarkWidth - padding;
                    top = mainMetadata.height - watermarkHeight - padding;
                    break;
            }
            
            const processedBuffer = await mainImage
                .composite([{
                    input: resizedWatermark,
                    left,
                    top,
                    blend: 'over'
                }])
                .toBuffer();

            logger.info('Watermark added successfully');
            return processedBuffer;
        } catch (error) {
            logger.error('Watermark error:', error);
            throw new Error('Failed to add watermark');
        }
    }

    // Generate multiple variants at once
    async generateVariants(buffer, variants = []) {
        const results = {};

        for (const variant of variants) {
            try {
                let processedBuffer;

                switch (variant.type) {
                    case 'thumbnail':
                        const thumbResult = await this.thumbnail(buffer, variant.options);
                        processedBuffer = thumbResult.buffer;
                        break;
                    case 'resized':
                        const resizeResult = await this.resize(buffer, variant.options);
                        processedBuffer = resizeResult.buffer;
                        break;
                    case 'converted':
                        const convertResult = await this.convert(buffer, variant.options.format, variant.options);
                        processedBuffer = convertResult.buffer;
                        break;
                    case 'compressed':
                        const compressResult = await this.compress(buffer, variant.options);
                        processedBuffer = compressResult.buffer;
                        break;
                    default:
                        continue;
                }

                results[variant.name] = {
                    buffer: processedBuffer,
                    metadata: await sharp(processedBuffer).metadata()
                };
            } catch (error) {
                logger.error(`Failed to generate variant ${variant.name}:`, error);
            }
        }

        return results;
    }

    // Validate image
    async validate(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            
            if (!metadata.width || !metadata.height) {
                return { valid: false, error: 'Invalid image dimensions' };
            }

            if (metadata.width > 10000 || metadata.height > 10000) {
                return { valid: false, error: 'Image dimensions too large' };
            }

            if (buffer.length > 50 * 1024 * 1024) { // 50MB
                return { valid: false, error: 'Image file too large' };
            }

            return { valid: true, metadata };
        } catch (error) {
            return { valid: false, error: 'Invalid image file' };
        }
    }
}

module.exports = new ImageProcessor();
