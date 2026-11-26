import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { verifyDatabaseIsolation } from '@/lib/sync/preflightGuard';
import { sanitizeForLogging, sanitizeString, sanitizeError } from '@/lib/redaction';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'CRITICAL';

export type LogModule =
  | 'SYSTEM'
  | 'META_API'
  | 'META_CONNECTION'
  | 'SYNC_ENGINE'
  | 'DATABASE'
  | 'USER_ACTION';

export interface LogContext {
  correlationId?: string;
  adAccountId?: string;
  syncJobId?: string;
  reportingDateFrom?: Date | string;
  reportingDateTo?: Date | string;
}

export interface MetaErrorInfo {
  code?: number;
  subcode?: number;
  isTransient?: boolean;
  fbtraceId?: string;
  message?: string;
  raw?: unknown;
}

export interface LogEventExtra {
  actor?: string;
  stage?: string;
  durationMs?: number;
  recordCount?: number;
  retryAttempt?: number;
  httpStatus?: number;
  metaError?: MetaErrorInfo;
  metadata?: unknown;
}

/**
 * Generates a standard RFC4122 v4 UUID for request correlation
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Structured Logging Service for DeweyMKTapp
 * Provides durable persistence in Neon PostgreSQL with safe runtime fallback,
 * automatic secret redaction, and database isolation enforcement.
 */
export class Logger {
  /**
   * Logs a structured event.
   * Never throws exceptions to ensure logging never crashes business logic.
   */
  public static async log(
    level: LogLevel,
    module: LogModule,
    eventType: string,
    message: string,
    ctx: LogContext = {},
    extra: LogEventExtra = {}
  ): Promise<void> {
    const logStart = Date.now();

    // 1. Sanitize text and message
    const sanitizedMsg = sanitizeString(message);
    const sanitizedEventType = sanitizeString(eventType);
    const sanitizedStage = extra.stage ? sanitizeString(extra.stage) : undefined;
    const sanitizedActor = extra.actor ? sanitizeString(extra.actor) : undefined;

    // 2. Extract deployment metadata without fabrication
    const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || null;

    // 3. Normalize reporting dates
    let reportingDateFrom: Date | undefined;
    let reportingDateTo: Date | undefined;
    if (ctx.reportingDateFrom) {
      reportingDateFrom = ctx.reportingDateFrom instanceof Date
        ? ctx.reportingDateFrom
        : new Date(ctx.reportingDateFrom);
    }
    if (ctx.reportingDateTo) {
      reportingDateTo = ctx.reportingDateTo instanceof Date
        ? ctx.reportingDateTo
        : new Date(ctx.reportingDateTo);
    }

    // 4. Sanitize Meta Error fields
    let metaErrorMessage: string | undefined;
    if (extra.metaError?.message) {
      metaErrorMessage = sanitizeString(extra.metaError.message);
    }

    // 5. Sanitize arbitrary metadata (allowlisted or sanitized nested payload as JSONB)
    let sanitizedMeta: Prisma.InputJsonValue | undefined = undefined;
    if (extra.metadata !== undefined && extra.metadata !== null) {
      sanitizedMeta = sanitizeForLogging(extra.metadata) as Prisma.InputJsonValue;
    } else if (extra.metaError?.raw) {
      sanitizedMeta = { rawError: sanitizeForLogging(extra.metaError.raw) } as Prisma.InputJsonValue;
    }

    // Construct the structured log record
    const record: Prisma.SyncLogCreateInput = {
      severity: level,
      module,
      eventType: sanitizedEventType,
      message: sanitizedMsg,
      actor: sanitizedActor || null,
      environment,
      commitSha,
      adAccountId: ctx.adAccountId || null,
      reportingDateFrom: reportingDateFrom || null,
      reportingDateTo: reportingDateTo || null,
      syncJobId: ctx.syncJobId || null,
      correlationId: ctx.correlationId || null,
      stage: sanitizedStage || null,
      durationMs: extra.durationMs !== undefined ? Math.round(extra.durationMs) : null,
      recordCount: extra.recordCount !== undefined ? extra.recordCount : null,
      retryAttempt: extra.retryAttempt !== undefined ? extra.retryAttempt : null,
      httpStatus: extra.httpStatus || null,
      metaErrorCode: extra.metaError?.code || null,
      metaErrorSubcode: extra.metaError?.subcode || null,
      metaIsTransient: extra.metaError?.isTransient !== undefined ? extra.metaError.isTransient : null,
      metaFbtraceId: extra.metaError?.fbtraceId ? sanitizeString(extra.metaError.fbtraceId) : null,
      metaErrorMessage: metaErrorMessage || null,
      sanitizedMeta,
    };

    // 6. Verify Database Isolation before attempting write to Neon
    let canPersistToDb = true;
    if (process.env.NODE_ENV !== 'test') {
      const isolation = verifyDatabaseIsolation();
      if (isolation.status === 'FAIL') {
        canPersistToDb = false;
        // Emit sanitized runtime log warning about isolation block
        const fallbackPayload = sanitizeForLogging({
          ...record,
          warning: '[ISOLATION_GUARD] Database write blocked due to endpoint mismatch.',
        });
        console.warn(`[SyncLog:IsolationBlocked] ${JSON.stringify(fallbackPayload)}`);
      }
    }

    // 7. Attempt persistence to Neon PostgreSQL
    if (canPersistToDb) {
      try {
        await prisma.syncLog.create({
          data: record,
        });
      } catch (persistErr: unknown) {
        // Fallback: Emit structured runtime output to console so Vercel logs capture it safely
        const sanitizedErr = sanitizeError(persistErr);
        const fallbackPayload = sanitizeForLogging({
          ...record,
          persistenceError: sanitizedErr.message,
          loggerOverheadMs: Date.now() - logStart,
        });
        console.error(`[SyncLog:PersistenceFallback] ${JSON.stringify(fallbackPayload)}`);
      }
    }
  }

  // Convenience shorthand methods
  public static info(module: LogModule, eventType: string, message: string, ctx?: LogContext, extra?: LogEventExtra) {
    return Logger.log('INFO', module, eventType, message, ctx, extra);
  }

  public static warn(module: LogModule, eventType: string, message: string, ctx?: LogContext, extra?: LogEventExtra) {
    return Logger.log('WARN', module, eventType, message, ctx, extra);
  }

  public static error(module: LogModule, eventType: string, message: string, ctx?: LogContext, extra?: LogEventExtra) {
    return Logger.log('ERROR', module, eventType, message, ctx, extra);
  }

  public static debug(module: LogModule, eventType: string, message: string, ctx?: LogContext, extra?: LogEventExtra) {
    return Logger.log('DEBUG', module, eventType, message, ctx, extra);
  }

  public static critical(module: LogModule, eventType: string, message: string, ctx?: LogContext, extra?: LogEventExtra) {
    return Logger.log('CRITICAL', module, eventType, message, ctx, extra);
  }
}
