const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Cloud Storage Service API',
            version: '1.0.0',
            description: 'A file upload and cloud storage service with AWS S3 integration, image processing, streaming capabilities, and security features.',
            contact: {
                name: 'API Support',
                email: 'support@example.com'
            },
            license: {
                name: 'Proprietary',
                url: 'https://example.com/license'
            }
        },
        servers: [
            {
                url: 'http://localhost:5000',
                description: 'Development server'
            },
            {
                url: 'https://api.example.com',
                description: 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        role: { type: 'string', enum: ['user', 'admin'] },
                        storageUsed: { type: 'number' },
                        storageLimit: { type: 'number' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                File: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        filename: { type: 'string' },
                        originalName: { type: 'string' },
                        mimetype: { type: 'string' },
                        size: { type: 'number' },
                        key: { type: 'string' },
                        location: { type: 'string' },
                        bucket: { type: 'string' },
                        storageType: { type: 'string', enum: ['s3', 'local', 'digitalocean', 'minio'] },
                        category: { type: 'string', enum: ['image', 'video', 'document', 'audio', 'other'] },
                        isPublic: { type: 'boolean' },
                        uploadedBy: { type: 'string' },
                        metadata: {
                            type: 'object',
                            properties: {
                                width: { type: 'number' },
                                height: { type: 'number' },
                                duration: { type: 'number' },
                                format: { type: 'string' }
                            }
                        },
                        variants: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    key: { type: 'string' },
                                    size: { type: 'number' },
                                    dimensions: { type: 'object' },
                                    format: { type: 'string' }
                                }
                            }
                        },
                        downloadCount: { type: 'number' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                UploadSession: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        uploadId: { type: 'string' },
                        filename: { type: 'string' },
                        originalName: { type: 'string' },
                        mimeType: { type: 'string' },
                        totalSize: { type: 'number' },
                        chunkSize: { type: 'number' },
                        totalChunks: { type: 'number' },
                        uploadedChunks: { type: 'array', items: { type: 'number' } },
                        status: { type: 'string', enum: ['pending', 'uploading', 'completed', 'failed', 'cancelled'] },
                        progress: { type: 'number' },
                        createdAt: { type: 'string', format: 'date-time' }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: { type: 'string' }
                    }
                }
            }
        }
    },
    apis: ['./routes/*.js', './controllers/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = specs;
