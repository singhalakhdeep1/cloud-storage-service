/**
 * Structured Logging Service for Cloud Storage Service
 * Implements structured logging with correlation IDs and context
 */
const { v4: uuidv4 } = require('uuid');

class StructuredLoggingService {
  constructor() {
    this.currentContext = null;
  }

  setContext(context) {
    this.currentContext = context;
  }

  getContext() {
    return this.currentContext;
  }

  logInformation(message, additionalContext) {
    const logEntry = this.createLogEntry('Information', message, additionalContext, null);
    console.log(JSON.stringify(logEntry));
  }

  logWarning(message, additionalContext) {
    const logEntry = this.createLogEntry('Warning', message, additionalContext, null);
    console.warn(JSON.stringify(logEntry));
  }

  logError(message, error, additionalContext) {
    const logEntry = this.createLogEntry('Error', message, additionalContext, error);
    console.error(JSON.stringify(logEntry));
  }

  logAuditEvent(eventType, description, additionalContext) {
    const context = { ...additionalContext };
    context['auditEventType'] = eventType;
    context['auditDescription'] = description;

    const logEntry = this.createLogEntry('Audit', `AUDIT: ${description}`, context, null);
    console.log(JSON.stringify(logEntry));
  }

  static createCorrelationId() {
    return uuidv4();
  }

  createLogEntry(level, message, additionalContext, error) {
    const context = this.currentContext || this.defaultContext();

    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      additionalContext,
      error
    };
  }

  defaultContext() {
    return {
      correlationId: StructuredLoggingService.createCorrelationId()
    };
  }
}

module.exports = StructuredLoggingService;
