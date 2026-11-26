import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { verifyDatabaseIsolation, assertDatabaseIsolation } from '@/lib/sync/preflightGuard';
import { Logger } from '@/lib/logger';
import { recordUserAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // 1. Strict Authentication Guard
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại với quyền quản trị.' },
        { status: 401 }
      );
    }

    // 2. Strict Database Isolation Preflight (Preview branch protection)
    const isolation = verifyDatabaseIsolation();
    if (isolation.status !== 'PASS') {
      return NextResponse.json(
        {
          success: false,
          errorCode: 'DATABASE_ISOLATION_FAILED',
          message: `Không thể áp dụng migration: Trạng thái cách ly là ${isolation.status}. ${isolation.message}`,
          isolation,
        },
        { status: 403 }
      );
    }

    assertDatabaseIsolation();

    // 3. Pre-Migration Baseline Verification
    const targetAccountId = 'act_1380498158917028';
    const targetDateStart = new Date('2026-10-01T00:00:00.000Z');
    const targetDateEnd = new Date('2026-10-01T23:59:59.999Z');

    // Baseline GIS Hà Nội advertising metrics for 2026-10-01
    const preInsights = await prisma.insightsDaily.findMany({
      where: {
        adAccount: { accountId: targetAccountId },
        date: { gte: targetDateStart, lte: targetDateEnd },
      },
      select: { id: true, spend: true, impressions: true, clicks: true },
    });

    const preInsightsCount = preInsights.length;
    const preStoredSpend = preInsights.reduce((sum, item) => sum + (item.spend || 0), 0);
    const preAuditLogCount = await prisma.auditLog.count();

    // Check if SyncLog table already exists
    interface TableCheckRow {
      exists: boolean;
    }
    const tableCheck = await prisma.$queryRaw<TableCheckRow[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SyncLog'
      ) as exists;
    `;
    const syncLogAlreadyExists = tableCheck[0]?.exists || false;

    // 4. Execute Additive DDL Migration
    // Idempotent execution of Enums, SyncLog table, and performance indexes
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogLevel') THEN
          CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'DEBUG', 'CRITICAL');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogModule') THEN
          CREATE TYPE "LogModule" AS ENUM ('SYSTEM', 'META_API', 'META_CONNECTION', 'SYNC_ENGINE', 'DATABASE', 'USER_ACTION');
        END IF;
      END$$;
    `);

    await prisma.$executeRawUnsafe(`
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
    `);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncLog_syncJobId_idx" ON "SyncLog"("syncJobId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncLog_correlationId_idx" ON "SyncLog"("correlationId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncLog_adAccountId_createdAt_idx" ON "SyncLog"("adAccountId", "createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncLog_severity_module_idx" ON "SyncLog"("severity", "module");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");`);

    // 5. Post-Migration Verification
    const postTableCheck = await prisma.$queryRaw<TableCheckRow[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SyncLog'
      ) as exists;
    `;
    const syncLogExistsNow = postTableCheck[0]?.exists || false;

    // Verify indexes
    interface IndexRow {
      indexname: string;
    }
    const indexes = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'SyncLog' OR tablename = 'AuditLog';
    `;
    const indexNames = indexes.map(i => i.indexname);

    // Verify advertising records & spend remain unchanged
    const postInsights = await prisma.insightsDaily.findMany({
      where: {
        adAccount: { accountId: targetAccountId },
        date: { gte: targetDateStart, lte: targetDateEnd },
      },
      select: { id: true, spend: true },
    });
    const postInsightsCount = postInsights.length;
    const postStoredSpend = postInsights.reduce((sum, item) => sum + (item.spend || 0), 0);
    const postAuditLogCount = await prisma.auditLog.count();

    const dataIntegrityPassed =
      preInsightsCount === postInsightsCount &&
      Math.round(preStoredSpend) === Math.round(postStoredSpend) &&
      postAuditLogCount >= preAuditLogCount;

    // Record User Action Audit
    await recordUserAction({
      userId: auth.user?.id || null,
      actorEmail: auth.user?.email || 'admin',
      action: 'APPLY_ADDITIVE_MIGRATION',
      entityType: 'DATABASE_SCHEMA',
      entityId: '20261126_add_synclog_additive',
      after: {
        syncLogAlreadyExists,
        syncLogExistsNow,
        indexesCreated: indexNames,
        dataIntegrityPassed,
      },
    });

    await Logger.info(
      'DATABASE',
      'AdditiveMigrationApplied',
      'Đã áp dụng thành công additive migration SyncLog trên Neon Preview.',
      {},
      {
        stage: 'database_migration',
        actor: auth.user?.email || 'admin',
        metadata: {
          dataIntegrityPassed,
          indexes: indexNames,
        },
      }
    );

    return NextResponse.json({
      success: true,
      migration: '20261126_add_synclog_additive',
      databaseIsolation: isolation,
      preMigration: {
        syncLogAlreadyExists,
        gisHanoiInsightsCount: preInsightsCount,
        gisHanoiStoredSpend: Math.round(preStoredSpend),
        auditLogCount: preAuditLogCount,
      },
      postMigration: {
        syncLogExists: syncLogExistsNow,
        gisHanoiInsightsCount: postInsightsCount,
        gisHanoiStoredSpend: Math.round(postStoredSpend),
        auditLogCount: postAuditLogCount,
        indexes: indexNames,
      },
      dataIntegrityVerified: dataIntegrityPassed,
      message: dataIntegrityPassed
        ? 'Migration thành công! Cấu trúc SyncLog đã sẵn sàng và toàn bộ dữ liệu lịch sử được bảo toàn.'
        : 'Cảnh báo: Phát hiện sai lệch số liệu sau migration.',
    });
  } catch (error: unknown) {
    console.error('Migration execution error:', error);
    const message = error instanceof Error ? error.message : 'Unknown migration error';
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
