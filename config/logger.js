const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');

// Daily rotate file transport for all logs
const allLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Daily rotate file transport for errors
const errorLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: logFormat
});

// Daily rotate file transport for uploads
const uploadLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'uploads-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        allLogsTransport,
        errorLogsTransport,
        uploadLogsTransport
    ],
    exitOnError: false
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Create a stream for Morgan HTTP logger
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    }
};

// Helper methods for specific log types
logger.upload = (message, meta = {}) => {
    logger.info(message, { ...meta, type: 'upload' });
};

logger.download = (message, meta = {}) => {
    logger.info(message, { ...meta, type: 'download' });
};

logger.security = (message, meta = {}) => {
    logger.warn(message, { ...meta, type: 'security' });
};

logger.performance = (message, meta = {}) => {
    logger.info(message, { ...meta, type: 'performance' });
};

logger.error = (message, meta = {}) => {
    logger.error(message, meta);
};

module.exports = logger;
