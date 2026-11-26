-- Migration: 20261126_add_synclog_additive
-- Description: Additive migration introducing SyncLog, enums (LogLevel, LogModule), and indexes.
-- Target: Neon PostgreSQL Preview branch (dewey-mkt-preview)

BEGIN;

-- 1. Create Enums if not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogLevel') THEN
    CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'DEBUG', 'CRITICAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogModule') THEN
    CREATE TYPE "LogModule" AS ENUM ('SYSTEM', 'META_API', 'META_CONNECTION', 'SYNC_ENGINE', 'DATABASE', 'USER_ACTION');
  END IF;
END$$;

-- 2. Create Additive SyncLog Table
CREATE TABLE IF NOT EXISTS "SyncLog" (
    "id" TEXT NOT NULL,
    "severity" "LogLevel" NOT NULL DEFAULT 'INFO',
    "module" "LogModule" NOT NULL DEFAULT 'SYSTEM',
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor" TEXT,
    "environment" TEXT,
    "commitSha" TEXT,
    "adAccountId" TEXT,
    "reportingDateFrom" TIMESTAMP(3),
    "reportingDateTo" TIMESTAMP(3),
    "syncJobId" TEXT,
    "correlationId" TEXT,
    "stage" TEXT,
    "durationMs" INTEGER,
    "recordCount" INTEGER,
    "retryAttempt" INTEGER,
    "httpStatus" INTEGER,
    "metaErrorCode" INTEGER,
    "metaErrorSubcode" INTEGER,
    "metaIsTransient" BOOLEAN,
    "metaFbtraceId" TEXT,
    "metaErrorMessage" TEXT,
    "sanitizedMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- 3. Create Performance & Query Indexes
CREATE INDEX IF NOT EXISTS "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SyncLog_syncJobId_idx" ON "SyncLog"("syncJobId");
CREATE INDEX IF NOT EXISTS "SyncLog_correlationId_idx" ON "SyncLog"("correlationId");
CREATE INDEX IF NOT EXISTS "SyncLog_adAccountId_createdAt_idx" ON "SyncLog"("adAccountId", "createdAt");
CREATE INDEX IF NOT EXISTS "SyncLog_severity_module_idx" ON "SyncLog"("severity", "module");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

COMMIT;
