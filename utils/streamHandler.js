const { PassThrough, pipeline } = require('stream');
const { promisify } = require('util');
const busboy = require('busboy');
const logger = require('../config/logger');

const pipelineAsync = promisify(pipeline);

class StreamHandler {
    // Create a pass-through stream for monitoring
    createMonitorStream(onData, onEnd) {
        const monitor = new PassThrough();
        
        monitor.on('data', (chunk) => {
            if (onData) onData(chunk);
        });
        
        monitor.on('end', () => {
            if (onEnd) onEnd();
        });
        
        return monitor;
    }

    // Parse multipart form data using Busboy
    parseMultipart(req, options = {}) {
        return new Promise((resolve, reject) => {
            const {
                headers,
                limits = {
                    fileSize: 100 * 1024 * 1024, // 100MB
                    files: 10
                }
            } = options;

            const busboyInstance = busboy({
                headers: req.headers,
                limits
            });

            const files = [];
            const fields = {};

            busboyInstance.on('file', (fieldname, file, filename, encoding, mimetype) => {
                const chunks = [];
                let size = 0;

                file.on('data', (chunk) => {
                    chunks.push(chunk);
                    size += chunk.length;
                });

                file.on('end', () => {
                    files.push({
                        fieldname,
                        filename,
                        encoding,
                        mimetype,
                        buffer: Buffer.concat(chunks),
                        size
                    });
                });

                file.on('error', (error) => {
                    logger.error('File stream error:', error);
                });
            });

            busboyInstance.on('field', (fieldname, value) => {
                fields[fieldname] = value;
            });

            busboyInstance.on('finish', () => {
                resolve({ files, fields });
            });

            busboyInstance.on('error', (error) => {
                logger.error('Busboy error:', error);
                reject(error);
            });

            req.pipe(busboyInstance);
        });
    }

    // Stream upload with progress tracking
    async streamUploadWithProgress(readStream, writeStream, onProgress) {
        let bytesUploaded = 0;
        const totalBytes = parseInt(readStream.headers?.['content-length']) || 0;

        const progressStream = new PassThrough();
        
        progressStream.on('data', (chunk) => {
            bytesUploaded += chunk.length;
            if (onProgress) {
                const percent = totalBytes > 0 ? (bytesUploaded / totalBytes) * 100 : 0;
                onProgress({
                    bytesUploaded,
                    totalBytes,
                    percent: Math.round(percent)
                });
            }
        });

        try {
            await pipelineAsync(readStream, progressStream, writeStream);
            logger.info('Stream upload completed', { bytesUploaded });
            return { bytesUploaded, success: true };
        } catch (error) {
            logger.error('Stream upload error:', error);
            throw error;
        }
    }

    // Create a chunked upload stream
    createChunkedStream(chunkSize = 5 * 1024 * 1024) {
        let buffer = Buffer.alloc(0);
        const chunks = [];

        return new PassThrough({
            transform(chunk, encoding, callback) {
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length >= chunkSize) {
                    const chunkData = buffer.slice(0, chunkSize);
                    chunks.push(chunkData);
                    buffer = buffer.slice(chunkSize);
                    this.push(chunkData);
                }

                callback();
            },
            flush(callback) {
                if (buffer.length > 0) {
                    chunks.push(buffer);
                    this.push(buffer);
                }
                callback();
            }
        });
    }

    // Merge chunks into a single buffer
    async mergeChunks(chunks) {
        return Buffer.concat(chunks);
    }

    // Stream with retry logic
    async streamWithRetry(readStream, writeStream, maxRetries = 3, delay = 1000) {
        let attempt = 0;

        while (attempt < maxRetries) {
            try {
                await pipelineAsync(readStream, writeStream);
                return { success: true, attempts: attempt + 1 };
            } catch (error) {
                attempt++;
                logger.warn(`Stream attempt ${attempt} failed:`, error.message);
                
                if (attempt >= maxRetries) {
                    throw error;
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
                
                // Reset streams for retry
                readStream.resume();
            }
        }
    }

    // Create a throttled stream
    createThrottledStream(bytesPerSecond) {
        let bytesSent = 0;
        let lastTime = Date.now();

        return new PassThrough({
            transform(chunk, encoding, callback) {
                const now = Date.now();
                const elapsed = now - lastTime;
                const allowedBytes = (elapsed / 1000) * bytesPerSecond;

                if (bytesSent + chunk.length <= allowedBytes) {
                    bytesSent += chunk.length;
                    this.push(chunk);
                    callback();
                } else {
                    const delay = ((bytesSent + chunk.length - allowedBytes) / bytesPerSecond) * 1000;
                    setTimeout(() => {
                        bytesSent = 0;
                        lastTime = Date.now();
                        this.push(chunk);
                        callback();
                    }, delay);
                }
            }
        });
    }

    // Stream to multiple destinations
    async streamToMultiple(readStream, writeStreams) {
        const passThrough = new PassThrough();
        
        // Pipe read stream to pass-through
        readStream.pipe(passThrough);

        // Pipe pass-through to all write streams
        const promises = writeStreams.map(writeStream => 
            pipelineAsync(passThrough, writeStream)
        );

        try {
            await Promise.all(promises);
            logger.info('Stream sent to multiple destinations successfully');
            return { success: true };
        } catch (error) {
            logger.error('Multi-stream error:', error);
            throw error;
        }
    }

    // Calculate stream hash
    async calculateStreamHash(readStream, algorithm = 'sha256') {
        const crypto = require('crypto');
        const hash = crypto.createHash(algorithm);
        
        const hashStream = new PassThrough({
            transform(chunk, encoding, callback) {
                hash.update(chunk);
                this.push(chunk);
                callback();
            }
        });

        readStream.pipe(hashStream);

        return new Promise((resolve, reject) => {
            hashStream.on('end', () => {
                resolve(hash.digest('hex'));
            });
            hashStream.on('error', reject);
        });
    }

    // Compress stream
    createCompressStream() {
        const zlib = require('zlib');
        return zlib.createGzip();
    }

    // Decompress stream
    createDecompressStream() {
        const zlib = require('zlib');
        return zlib.createGunzip();
    }

    // Stream with timeout
    async streamWithTimeout(readStream, writeStream, timeoutMs = 30000) {
        const timeout = setTimeout(() => {
            readStream.destroy();
            writeStream.destroy();
            throw new Error('Stream timeout');
        }, timeoutMs);

        try {
            await pipelineAsync(readStream, writeStream);
            clearTimeout(timeout);
            return { success: true };
        } catch (error) {
            clearTimeout(timeout);
            throw error;
        }
    }

    // Validate stream size
    validateStreamSize(maxSize) {
        let totalSize = 0;

        return new PassThrough({
            transform(chunk, encoding, callback) {
                totalSize += chunk.length;

                if (totalSize > maxSize) {
                    callback(new Error(`Stream size exceeded maximum of ${maxSize} bytes`));
                    return;
                }

                this.push(chunk);
                callback();
            }
        });
    }
}

module.exports = new StreamHandler();
