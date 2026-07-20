const crypto = require('crypto');
const helmet = require('helmet');

/**
 * File type validation middleware
 */
const validateFileType = (allowedTypes = []) => {
  return (req, res, next) => {
    if (req.file && !allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`
      });
    }
    next();
  };
};

/**
 * File size validation middleware
 */
const validateFileSize = (maxSize = 10 * 1024 * 1024) => {
  return (req, res, next) => {
    if (req.file && req.file.size > maxSize) {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)} MB`
      });
    }
    next();
  };
};

/**
 * Virus scanning middleware (placeholder)
 * In production, integrate with ClamAV or similar
 */
const scanForViruses = async (req, res, next) => {
  if (req.file) {
    // Placeholder for virus scanning
    // In production, integrate with ClamAV or similar service
    console.log(`Scanning file: ${req.file.filename}`);
    
    // Simulate scan delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // For demo purposes, always pass
    // In production, implement actual virus scanning
  }
  next();
};

/**
 * File encryption middleware
 * Encrypts file content before storage
 */
const encryptFile = (req, res, next) => {
  if (req.file && process.env.ENCRYPTION_KEY) {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);

    try {
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(req.file.buffer);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      req.file.encrypted = true;
      req.file.iv = iv.toString('hex');
      req.file.authTag = authTag.toString('hex');
      req.file.buffer = encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
    }
  }
  next();
};

/**
 * File decryption middleware
 * Decrypts file content before sending to client
 */
const decryptFile = (file) => {
  if (file.encrypted && process.env.ENCRYPTION_KEY) {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(file.iv, 'hex');
    const authTag = Buffer.from(file.authTag, 'hex');

    try {
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(file.buffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return file.buffer;
    }
  }
  return file.buffer;
};

/**
 * Content Security Policy middleware
 */
const contentSecurityPolicy = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"]
  }
});

/**
 * Sanitize filename
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255);
};

/**
 * Generate secure filename
 */
const generateSecureFilename = (originalFilename) => {
  const sanitized = sanitizeFilename(originalFilename);
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const ext = sanitized.split('.').pop();
  const name = sanitized.replace(`.${ext}`, '');
  return `${name}_${timestamp}_${random}.${ext}`;
};

module.exports = {
  validateFileType,
  validateFileSize,
  scanForViruses,
  encryptFile,
  decryptFile,
  contentSecurityPolicy,
  sanitizeFilename,
  generateSecureFilename
};
