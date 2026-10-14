/** Runs before every test file: never touch a hosted database or real cloud storage, whatever .env says. */
process.env.NODE_ENV = 'test';
const uri = process.env.MONGODB_URI;
if (!uri || /mongodb\+srv:|\.mongodb\.net/i.test(uri)) process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/file-upload-test';
process.env.MONGODB_TEST_URI ||= process.env.MONGODB_URI;
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.STORAGE_PROVIDER = 'local';
process.env.LOCAL_STORAGE_PATH = require('path').join(require('os').tmpdir(), 'cloud-storage-jest');
for (const key of ['REDIS_URL', 'REDIS_HOST', 'ENABLE_VIRUS_SCAN']) process.env[key] = '';
