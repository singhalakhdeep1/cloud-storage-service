import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const isTest = process.env.NODE_ENV === 'test';
const logsDir = path.join(process.cwd(), 'logs');

const fileFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.splat(), winston.format.json());

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, requestId, userId, ...meta }) => {
        const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}${requestId ? ` [${String(requestId).slice(0, 8)}]` : ''}${userId ? ` u:${String(userId).slice(-6)}` : ''}: ${message}${extra}`;
    })
);

const transports: winston.transport[] = isTest
    ? []
    : [
          new DailyRotateFile({ filename: path.join(logsDir, 'combined-%DATE%.log'), datePattern: 'YYYY-MM-DD', maxSize: '20m', maxFiles: '14d', format: fileFormat }),
          new DailyRotateFile({ filename: path.join(logsDir, 'error-%DATE%.log'), datePattern: 'YYYY-MM-DD', maxSize: '20m', maxFiles: '30d', level: 'error', format: fileFormat }),
          new DailyRotateFile({ filename: path.join(logsDir, 'uploads-%DATE%.log'), datePattern: 'YYYY-MM-DD', maxSize: '20m', maxFiles: '14d', format: fileFormat }),
      ];

const base = winston.createLogger({ level: process.env.LOG_LEVEL || 'info', silent: isTest && !process.env.LOG_IN_TESTS, format: fileFormat, transports, exitOnError: false });
if (process.env.NODE_ENV !== 'production') base.add(new winston.transports.Console({ format: consoleFormat }));

type Meta = Record<string, unknown>;

export interface AppLogger extends winston.Logger {
    /** Upload and download events (their own filter in the log pipeline). */
    upload(message: string, meta?: Meta): void;
    download(message: string, meta?: Meta): void;
    /** A security-relevant event. */
    security(message: string, meta?: Meta): void;
    performance(message: string, meta?: Meta): void;
}

const logger = base as AppLogger;
logger.upload = (message, meta = {}) => void logger.info(message, { ...meta, type: 'upload' });
logger.download = (message, meta = {}) => void logger.info(message, { ...meta, type: 'download' });
logger.security = (message, meta = {}) => void logger.warn(message, { ...meta, type: 'security' });
logger.performance = (message, meta = {}) => void logger.info(message, { ...meta, type: 'performance' });

export const logStream = { write: (message: string) => void logger.info(message.trim()) };
export default logger;
