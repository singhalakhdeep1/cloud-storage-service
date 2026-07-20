# Cloud Storage Service

![Node.js](https://img.shields.io/badge/Node.js-18.x-green)
![Express](https://img.shields.io/badge/Express-4.18-white)
![AWS S3](https://img.shields.io/badge/AWS_S3-orange)
![Multer](https://img.shields.io/badge/Multer-1.4-blue)
![License](https://img.shields.io/badge/License-MIT-blue)

A production-ready file upload and cloud storage service with AWS S3 integration, image processing, streaming capabilities, and enterprise-grade security features.

## 📋 Overview

The Cloud Storage Service is a comprehensive file management solution designed to handle secure file uploads, storage, and retrieval with support for multiple cloud providers. Built with Node.js, Express, and AWS S3, this service implements streaming for large files, image optimization, and secure file sharing.

## ✨ Features

### Core Functionality
- **Single & Multiple Uploads**: Handle single and batch file uploads efficiently
- **AWS S3 Integration**: Seamless integration with AWS S3 and compatible services
- **Streaming Uploads**: Stream large files directly to cloud storage
- **Image Processing**: Automatic image resizing, compression, and format conversion
- **File Validation**: Comprehensive validation for file type, size, and dimensions
- **Presigned URLs**: Generate secure, time-limited URLs for file access

### Advanced Features
- **Multi-Cloud Support**: AWS S3, DigitalOcean Spaces, MinIO compatibility
- **Image Optimization**: Automatic thumbnail generation and compression
- **File Encryption**: Client-side encryption for sensitive files
- **CDN Integration**: CloudFront/Cloudflare CDN support
- **File Versioning**: Track and manage file versions
- **Chunked Uploads**: Resumable uploads for large files

### Security & Performance
- **Access Control**: Bucket-level and object-level access policies
- **Virus Scanning**: Integration with ClamAV for malware detection
- **Rate Limiting**: Configurable upload rate limits
- **Compression**: Gzip compression for faster transfers
- **Caching**: Intelligent caching strategies for frequently accessed files

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18.x | Runtime environment |
| Express.js | 4.18.x | Web framework |
| AWS SDK | 3.x | AWS S3 integration |
| Multer | 1.4.x | File upload handling |
| Sharp | 0.33.x | Image processing |
| Busboy | 1.0.x | Streaming file uploads |
| ClamAV | 1.0.x | Virus scanning |
| Redis | 7.x | Caching layer |
| Winston | 3.10.x | Logging |

## 📁 Project Structure

```
cloud-storage-service/
├── config/
│   ├── aws.js               # AWS S3 configuration
│   ├── cloudflare.js        # CDN configuration
│   └── redis.js             # Redis configuration
├── controllers/
│   ├── uploadController.js  # Upload logic
│   └── fileController.js    # File management
├── middleware/
│   ├── upload.js            # Multer configuration
│   ├── validation.js        # File validation
│   └── security.js          # Security checks
├── models/
│   ├── File.js              # File metadata schema
│   └── UploadSession.js     # Upload session tracking
├── routes/
│   ├── uploadRoutes.js      # Upload endpoints
│   └── fileRoutes.js        # File management endpoints
├── utils/
│   ├── s3.js                # S3 operations
│   ├── imageProcessor.js    # Image processing
│   ├── virusScanner.js      # Virus scanning
│   └── streamHandler.js     # Stream utilities
├── tests/
│   ├── upload.test.js       # Upload tests
│   └── file.test.js         # File management tests
├── .env.example              # Environment template
├── .gitignore
├── package.json
└── server.js                 # Entry point
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- AWS Account with S3 access
- Redis 7.x (for caching)
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Alakhdeepsingh/cloud-storage-service.git
cd cloud-storage-service
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
PORT=3000
NODE_ENV=development
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
AWS_CLOUDFRONT_DISTRIBUTION=your-cloudfront-id
REDIS_URL=redis://localhost:6379
MAX_FILE_SIZE=104857600
ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf
ENABLE_VIRUS_SCAN=true
ENABLE_IMAGE_PROCESSING=true
```

4. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

### Running Tests

```bash
npm test
```

---

## 📡 API Endpoints

### File Upload

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/upload/single` | Upload single file | Yes |
| POST | `/api/upload/multiple` | Upload multiple files | Yes |
| POST | `/api/upload/chunked` | Initiate chunked upload | Yes |
| PUT | `/api/upload/chunked/:id` | Upload chunk | Yes |
| POST | `/api/upload/chunked/:id/complete` | Complete chunked upload | Yes |

### File Management

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/files/:id` | Get file metadata | Yes |
| GET | `/api/files/:id/download` | Download file | Yes |
| GET | `/api/files/:id/presigned` | Generate presigned URL | Yes |
| DELETE | `/api/files/:id` | Delete file | Yes |
| GET | `/api/files` | List user files | Yes |

### Image Processing

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/images/resize` | Resize image | Yes |
| POST | `/api/images/thumbnail` | Generate thumbnail | Yes |
| POST | `/api/images/convert` | Convert image format | Yes |
| GET | `/api/images/:id/variants` | Get image variants | Yes |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api-docs` | Swagger documentation |
| GET | `/api/storage/stats` | Storage statistics |

---

## 🔐 Security Features

### Upload Security
- **File Type Validation**: Strict MIME type checking
- **File Size Limits**: Configurable maximum file sizes
- **Virus Scanning**: ClamAV integration for malware detection
- **Content Inspection**: Deep file content analysis
- **Rate Limiting**: Upload rate limits per user

### Access Control
- **Authentication**: JWT-based authentication required
- **Authorization**: User-scoped file access
- **Presigned URLs**: Time-limited access with expiration
- **Bucket Policies**: AWS IAM policies for access control
- **Encryption**: Server-side and client-side encryption

### Data Protection
- **SSL/TLS**: All transfers encrypted
- **Encryption at Rest**: AWS S3 server-side encryption
- **Secure Storage**: Isolated user storage buckets
- **Audit Logging**: All file operations logged

---

## 📊 Database Schema

### File Model
```javascript
{
  user: ObjectId (ref: User),
  filename: String (required),
  originalName: String,
  mimeType: String (required),
  size: Number (required),
  bucket: String,
  key: String (unique),
  location: String (S3 URL),
  etag: String,
  variants: [{
    type: String (thumbnail, resized, original),
    key: String,
    size: Number,
    dimensions: { width: Number, height: Number }
  }],
  metadata: {
    width: Number,
    height: Number,
    format: String,
    duration: Number (for videos)
  },
  isPublic: Boolean (default: false),
  isEncrypted: Boolean (default: false),
  virusScanned: Boolean (default: false),
  virusStatus: String,
  downloadCount: Number (default: 0),
  expiresAt: Date,
  createdAt: Date
}
```

### UploadSession Model
```javascript
{
  user: ObjectId (ref: User),
  filename: String,
  totalSize: Number,
  chunkSize: Number,
  totalChunks: Number,
  uploadedChunks: [Number],
  status: String (pending, uploading, completed, failed),
  fileId: ObjectId (ref: File),
  expiresAt: Date,
  createdAt: Date
}
```

---

## 🧪 Testing

The project includes comprehensive test suites:

- **Upload Tests**: Single, multiple, and chunked uploads
- **Validation Tests**: File type, size, and content validation
- **Security Tests**: Virus scanning, access control
- **Image Processing Tests**: Resize, thumbnail, conversion
- **Performance Tests**: Large file handling, streaming

Run tests with coverage:
```bash
npm test -- --coverage
```

---

## 📈 Monitoring & Logging

### Winston Logger Configuration
- **Console**: Colored output for development
- **File**: Combined logs in `logs/combined.log`
- **Error File**: Error-specific logs in `logs/error.log`
- **Upload File**: Upload-specific logs in `logs/uploads.log`
- **Log Levels**: error, warn, info, http, debug

### Metrics Tracked
- Upload success/failure rates
- File size distribution
- Storage usage per user
- CDN cache hit rates
- Virus detection rates

---

## 🚀 Deployment

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-production-bucket
AWS_CLOUDFRONT_DISTRIBUTION=your-cloudfront-id
REDIS_URL=redis://your-redis-instance:6379
MAX_FILE_SIZE=104857600
ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf
ENABLE_VIRUS_SCAN=true
ENABLE_IMAGE_PROCESSING=true
CDN_URL=https://your-cdn-domain.com
```

### Deployment Platforms

- **Heroku**: Ready for Heroku deployment with S3 add-on
- **Railway**: Compatible with Railway platform
- **AWS**: Can be deployed to EC2 or Lambda
- **DigitalOcean**: Compatible with App Platform with Spaces

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License.

---

## 👨‍💻 Author

**Alakhdeep Singh**

- GitHub: [@Alakhdeepsingh](https://github.com/Alakhdeepsingh)
- LinkedIn: [Alakhdeep Singh](https://linkedin.com/in/alakhdeepsingh)

---

## 🙏 Acknowledgments

- Built following AWS S3 best practices
- Image processing powered by Sharp library
- Security patterns from OWASP guidelines
- Inspired by industry-standard file storage services
