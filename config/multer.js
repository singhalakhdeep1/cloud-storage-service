const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Memory storage for S3 upload
const memoryStorage = multer.memoryStorage();

// Disk storage for local upload
const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|mp4|mp3/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only images, PDFs, documents, and media files are allowed.'));
    }
};

// Multer config for memory storage (S3)
exports.uploadMemory = multer({
    storage: memoryStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter
});

// Multer config for disk storage (local)
exports.uploadDisk = multer({
    storage: diskStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter
});
