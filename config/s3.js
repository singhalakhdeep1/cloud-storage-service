const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Initialize S3 Client
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Upload file to S3
exports.uploadToS3 = async (file, key) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    return {
        key,
        location: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        bucket: process.env.AWS_S3_BUCKET
    };
};

// Get file from S3
exports.getFromS3 = async (key) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key
    };

    const command = new GetObjectCommand(params);
    return await s3Client.send(command);
};

// Delete file from S3
exports.deleteFromS3 = async (key) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key
    };

    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
};

// Generate presigned URL
exports.getPresignedUrl = async (key, expiresIn = 3600) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key
    };

    const command = new GetObjectCommand(params);
    return await getSignedUrl(s3Client, command, { expiresIn });
};

// Generate presigned upload URL
exports.getPresignedUploadUrl = async (key, contentType, expiresIn = 3600) => {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        ContentType: contentType
    };

    const command = new PutObjectCommand(params);
    return await getSignedUrl(s3Client, command, { expiresIn });
};
