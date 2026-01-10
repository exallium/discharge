import winston from 'winston';

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * Structured log context
 */
export interface LogContext {
  [key: string]: any;
}

/**
 * Get log level from environment
 */
function getLogLevel(): string {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && ['error', 'warn', 'info', 'debug'].includes(level)) {
    return level;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Get log format from environment
 */
function getLogFormat(): 'json' | 'pretty' {
  const format = process.env.LOG_FORMAT?.toLowerCase();
  return format === 'pretty' ? 'pretty' : 'json';
}

/**
 * Create winston logger instance
 */
const createLogger = () => {
  const logFormat = getLogFormat();
  const level = getLogLevel();

  // Pretty format for development
  const prettyFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level}]: ${message} ${metaStr}`;
    })
  );

  // JSON format for production
  const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );

  return winston.createLogger({
    level,
    format: logFormat === 'pretty' ? prettyFormat : jsonFormat,
    defaultMeta: {
      service: 'ai-bug-fixer-router',
      environment: process.env.NODE_ENV || 'development',
    },
    transports: [
      new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true,
      }),
    ],
  });
};

// Create singleton logger instance
const winstonLogger = createLogger();

/**
 * Logger class with structured logging support
 */
export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  /**
   * Log error message
   */
  error(message: string, meta?: LogContext): void {
    winstonLogger.error(message, { ...this.context, ...meta });
  }

  /**
   * Log warning message
   */
  warn(message: string, meta?: LogContext): void {
    winstonLogger.warn(message, { ...this.context, ...meta });
  }

  /**
   * Log info message
   */
  info(message: string, meta?: LogContext): void {
    winstonLogger.info(message, { ...this.context, ...meta });
  }

  /**
   * Log debug message
   */
  debug(message: string, meta?: LogContext): void {
    winstonLogger.debug(message, { ...this.context, ...meta });
  }

  /**
   * Log with custom level
   */
  log(level: LogLevel, message: string, meta?: LogContext): void {
    winstonLogger.log(level, message, { ...this.context, ...meta });
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create a logger for a specific module/component
 */
export function createModuleLogger(module: string, meta?: LogContext): Logger {
  return new Logger({ module, ...meta });
}

/**
 * Create a logger for a specific job
 */
export function createJobLogger(jobId: string, projectId?: string): Logger {
  return new Logger({ jobId, projectId });
}

/**
 * Create a logger for a specific trigger event
 */
export function createTriggerLogger(triggerType: string, triggerId: string): Logger {
  return new Logger({ triggerType, triggerId });
}

/**
 * Express middleware for request logging
 */
export function requestLogger() {
  const shouldLog = process.env.LOG_REQUESTS !== 'false';

  return (req: any, res: any, next: any) => {
    if (!shouldLog) {
      return next();
    }

    const start = Date.now();
    const requestId = req.headers['x-request-id'] || generateRequestId();

    // Add request ID to request object
    req.requestId = requestId;

    // Log request
    logger.info('HTTP Request', {
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Log response
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? LogLevel.ERROR : res.statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO;

      logger.log(level, 'HTTP Response', {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      });
    });

    next();
  };
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Log unhandled errors
 */
export function logUnhandledErrors(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
    });
    // Give logger time to write before exiting
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
  });
}
