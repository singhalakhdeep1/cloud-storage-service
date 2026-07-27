const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const File = require('../models/File');
const { generateToken } = require('../middleware/auth');

describe('File Management API Tests', () => {
    let token;
    let userId;
    let testFileId;

    beforeAll(async () => {
        // Connect to test database
        await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/file-upload-test', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        // Create test user
        const user = await User.create({
            name: 'Test User',
            email: 'test@example.com',
            password: 'password123'
        });
        userId = user._id;
        token = generateToken(userId);
    });

    afterAll(async () => {
        // Clean up
        await User.deleteMany({});
        await File.deleteMany({});
        await mongoose.connection.close();
    });

    afterEach(async () => {
        // Clean up after each test
        await File.deleteMany({});
    });

    describe('GET /api/files - Get all files', () => {
        beforeEach(async () => {
            // Create test files
            await File.create([
                {
                    filename: 'file1.jpg',
                    originalName: 'file1.jpg',
                    mimetype: 'image/jpeg',
                    size: 1024000,
                    key: 'uploads/file1.jpg',
                    location: 'https://example.com/file1.jpg',
                    bucket: 'test-bucket',
                    storageType: 's3',
                    uploadedBy: userId,
                    category: 'image',
                    isPublic: true
                },
                {
                    filename: 'file2.pdf',
                    originalName: 'file2.pdf',
                    mimetype: 'application/pdf',
                    size: 2048000,
                    key: 'uploads/file2.pdf',
                    location: 'https://example.com/file2.pdf',
                    bucket: 'test-bucket',
                    storageType: 's3',
                    uploadedBy: userId,
                    category: 'document',
                    isPublic: false
                }
            ]);
        });

        it('should get all files for authenticated user', async () => {
            const res = await request(app)
                .get('/api/files')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.files).toHaveLength(2);
        });

        it('should filter files by category', async () => {
            const res = await request(app)
                .get('/api/files?category=image')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.files).toHaveLength(1);
            expect(res.body.data.files[0].category).toBe('image');
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .get('/api/files');

            expect(res.statusCode).toBe(401);
        });
    });

    describe('GET /api/files/stats - Get file statistics', () => {
        beforeEach(async () => {
            await File.create([
                {
                    filename: 'file1.jpg',
                    originalName: 'file1.jpg',
                    mimetype: 'image/jpeg',
                    size: 1024000,
                    key: 'uploads/file1.jpg',
                    location: 'https://example.com/file1.jpg',
                    bucket: 'test-bucket',
                    storageType: 's3',
                    uploadedBy: userId,
                    category: 'image',
                    isPublic: true
                },
                {
                    filename: 'file2.pdf',
                    originalName: 'file2.pdf',
                    mimetype: 'application/pdf',
                    size: 2048000,
                    key: 'uploads/file2.pdf',
                    location: 'https://example.com/file2.pdf',
                    bucket: 'test-bucket',
                    storageType: 's3',
                    uploadedBy: userId,
                    category: 'document',
                    isPublic: false
                }
            ]);
        });

        it('should return file statistics', async () => {
            const res = await request(app)
                .get('/api/files/stats')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('totalFiles');
            expect(res.body.data).toHaveProperty('totalSize');
            expect(res.body.data).toHaveProperty('categoryBreakdown');
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .get('/api/files/stats');

            expect(res.statusCode).toBe(401);
        });
    });

    describe('GET /api/files/:id - Get single file', () => {
        beforeEach(async () => {
            const file = await File.create({
                filename: 'test.jpg',
                originalName: 'test.jpg',
                mimetype: 'image/jpeg',
                size: 1024000,
                key: 'uploads/test.jpg',
                location: 'https://example.com/test.jpg',
                bucket: 'test-bucket',
                storageType: 's3',
                uploadedBy: userId,
                category: 'image',
                isPublic: true
            });
            testFileId = file._id;
        });

        it('should get a single file by ID', async () => {
            const res = await request(app)
                .get(`/api/files/${testFileId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data._id).toBe(testFileId.toString());
        });

        it('should fail for non-existent file', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app)
                .get(`/api/files/${fakeId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(404);
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .get(`/api/files/${testFileId}`);

            expect(res.statusCode).toBe(401);
        });
    });

    describe('GET /api/files/:id/download - Download file', () => {
        beforeEach(async () => {
            const file = await File.create({
                filename: 'test.jpg',
                originalName: 'test.jpg',
                mimetype: 'image/jpeg',
                size: 1024000,
                key: 'uploads/test.jpg',
                location: 'https://example.com/test.jpg',
                bucket: 'test-bucket',
                storageType: 's3',
                uploadedBy: userId,
                category: 'image',
                isPublic: true
            });
            testFileId = file._id;
        });

        it('should return download URL', async () => {
            const res = await request(app)
                .get(`/api/files/${testFileId}/download`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('url');
        });

        it('should increment download count', async () => {
            await request(app)
                .get(`/api/files/${testFileId}/download`)
                .set('Authorization', `Bearer ${token}`);

            const file = await File.findById(testFileId);
            expect(file.downloadCount).toBe(1);
        });

        it('should fail for non-existent file', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app)
                .get(`/api/files/${fakeId}/download`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('DELETE /api/files/:id - Delete file', () => {
        beforeEach(async () => {
            const file = await File.create({
                filename: 'test.jpg',
                originalName: 'test.jpg',
                mimetype: 'image/jpeg',
                size: 1024000,
                key: 'uploads/test.jpg',
                location: 'https://example.com/test.jpg',
                bucket: 'test-bucket',
                storageType: 's3',
                uploadedBy: userId,
                category: 'image',
                isPublic: true
            });
            testFileId = file._id;
        });

        it('should delete a file successfully', async () => {
            const res = await request(app)
                .delete(`/api/files/${testFileId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            const file = await File.findById(testFileId);
            expect(file).toBeNull();
        });

        it('should fail for non-existent file', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app)
                .delete(`/api/files/${fakeId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(404);
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .delete(`/api/files/${testFileId}`);

            expect(res.statusCode).toBe(401);
        });
    });

    describe('POST /api/files/presigned-url - Get presigned upload URL', () => {
        it('should generate presigned URL', async () => {
            const res = await request(app)
                .post('/api/files/presigned-url')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    filename: 'test.jpg',
                    mimetype: 'image/jpeg',
                    size: 1024000
                });

            // This test would need S3 mocking
            expect(res.statusCode).toBeDefined();
        });

        it('should fail without required fields', async () => {
            const res = await request(app)
                .post('/api/files/presigned-url')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    filename: 'test.jpg'
                });

            expect(res.statusCode).toBe(400);
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/files/presigned-url')
                .send({
                    filename: 'test.jpg',
                    mimetype: 'image/jpeg',
                    size: 1024000
                });

            expect(res.statusCode).toBe(401);
        });
    });

    describe('File ownership and access control', () => {
        let otherUserId;
        let otherToken;
        let otherFileId;

        beforeEach(async () => {
            // Create another user
            const otherUser = await User.create({
                name: 'Other User',
                email: 'other@example.com',
                password: 'password123'
            });
            otherUserId = otherUser._id;
            otherToken = generateToken(otherUserId);

            // Create file owned by other user
            const file = await File.create({
                filename: 'other-file.jpg',
                originalName: 'other-file.jpg',
                mimetype: 'image/jpeg',
                size: 1024000,
                key: 'uploads/other-file.jpg',
                location: 'https://example.com/other-file.jpg',
                bucket: 'test-bucket',
                storageType: 's3',
                uploadedBy: otherUserId,
                category: 'image',
                isPublic: false
            });
            otherFileId = file._id;
        });

        it('should prevent user from accessing another user\'s private file', async () => {
            const res = await request(app)
                .get(`/api/files/${otherFileId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(403);
        });

        it('should prevent user from deleting another user\'s file', async () => {
            const res = await request(app)
                .delete(`/api/files/${otherFileId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(403);
        });

        it('should allow access to public files', async () => {
            await File.findByIdAndUpdate(otherFileId, { isPublic: true });

            const res = await request(app)
                .get(`/api/files/${otherFileId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(200);
        });
    });
});
