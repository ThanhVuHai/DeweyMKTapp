import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import type { LogLevel, LogModule } from '@/lib/logger';
import { sanitizeString } from '@/lib/redaction';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const tab = (searchParams.get('tab') || 'all') as 'all' | 'sync' | 'user';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 100);
    const skip = (page - 1) * limit;

    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const severity = searchParams.get('severity') as LogLevel | null;
    const moduleFilter = searchParams.get('module') as LogModule | null;
    const adAccountId = searchParams.get('adAccountId');
    const syncJobId = searchParams.get('syncJobId');
    const correlationId = searchParams.get('correlationId');
    const search = searchParams.get('search')?.trim();

    // 1. Fetch SyncLogs
    if (tab === 'sync') {
      const where: Prisma.SyncLogWhereInput = {};

      if (dateFrom) {
        where.createdAt = { ...(where.createdAt as object), gte: new Date(dateFrom + 'T00:00:00.000Z') };
      }
      if (dateTo) {
        where.createdAt = { ...(where.createdAt as object), lte: new Date(dateTo + 'T23:59:59.999Z') };
      }
      if (severity) {
        where.severity = severity;
      }
      if (moduleFilter) {
        where.module = moduleFilter;
      }
      if (adAccountId) {
        where.adAccountId = { contains: adAccountId, mode: 'insensitive' };
      }
      if (syncJobId) {
        where.syncJobId = { contains: syncJobId, mode: 'insensitive' };
      }
      if (correlationId) {
        where.correlationId = { contains: correlationId, mode: 'insensitive' };
      }
      if (search) {
        where.OR = [
          { message: { contains: search, mode: 'insensitive' } },
          { eventType: { contains: search, mode: 'insensitive' } },
          { metaErrorMessage: { contains: search, mode: 'insensitive' } },
          { syncJobId: { contains: search, mode: 'insensitive' } },
          { correlationId: { contains: search, mode: 'insensitive' } },
        ];
      }

      let total = 0;
      let rawLogs: Array<Prisma.SyncLogGetPayload<Record<string, never>>> = [];
      let migrationNeeded = false;

      try {
        const [cnt, logs] = await Promise.all([
          prisma.syncLog.count({ where }),
          prisma.syncLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);
        total = cnt;
        rawLogs = logs;
      } catch (err: unknown) {
        console.warn('SyncLog table unavailable, migration may be needed:', err);
        migrationNeeded = true;
      }

      const logs = rawLogs.map(l => ({
        ...l,
        source: 'SYNC_LOG',
      }));

      return NextResponse.json({
        success: true,
        tab,
        migrationNeeded,
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    }

    // 2. Fetch User Action AuditLogs
    if (tab === 'user') {
      const where: Prisma.AuditLogWhereInput = {};

      if (dateFrom) {
        where.createdAt = { ...(where.createdAt as object), gte: new Date(dateFrom + 'T00:00:00.000Z') };
      }
      if (dateTo) {
        where.createdAt = { ...(where.createdAt as object), lte: new Date(dateTo + 'T23:59:59.999Z') };
      }
      if (adAccountId) {
        where.entityId = { contains: adAccountId, mode: 'insensitive' };
      }
      if (search) {
        where.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { entityType: { contains: search, mode: 'insensitive' } },
          { entityId: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, rawLogs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                name: true,
                email: true,
                role: true,
              },
            },
          },
        }),
      ]);

      const logs = rawLogs.map(l => ({
        id: l.id,
        source: 'AUDIT_LOG',
        severity: 'INFO',
        module: 'USER_ACTION',
        eventType: l.action,
        message: `Thao tác: ${l.action} trên ${l.entityType} (${l.entityId})`,
        actor: l.user?.name || l.user?.email || 'Hệ thống (System)',
        adAccountId: l.entityType === 'AdAccount' ? l.entityId : null,
        syncJobId: l.entityType === 'SyncJob' ? l.entityId : null,
        beforeJson: l.beforeJson ? sanitizeString(l.beforeJson) : null,
        afterJson: l.afterJson ? sanitizeString(l.afterJson) : null,
        createdAt: l.createdAt,
        user: l.user,
      }));

      return NextResponse.json({
        success: true,
        tab,
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    }

    // 3. Tab === 'all' (Unified combined feed)
    // We query the most recent items from both tables and merge with stable chronological ordering
    const syncWhere: Prisma.SyncLogWhereInput = {};
    const auditWhere: Prisma.AuditLogWhereInput = {};

    if (dateFrom) {
      const gte = new Date(dateFrom + 'T00:00:00.000Z');
      syncWhere.createdAt = { ...(syncWhere.createdAt as object), gte };
      auditWhere.createdAt = { ...(auditWhere.createdAt as object), gte };
    }
    if (dateTo) {
      const lte = new Date(dateTo + 'T23:59:59.999Z');
      syncWhere.createdAt = { ...(syncWhere.createdAt as object), lte };
      auditWhere.createdAt = { ...(auditWhere.createdAt as object), lte };
    }
    if (severity) {
      syncWhere.severity = severity;
    }
    if (moduleFilter) {
      syncWhere.module = moduleFilter;
    }
    if (adAccountId) {
      syncWhere.adAccountId = { contains: adAccountId, mode: 'insensitive' };
      auditWhere.entityId = { contains: adAccountId, mode: 'insensitive' };
    }
    if (syncJobId) {
      syncWhere.syncJobId = { contains: syncJobId, mode: 'insensitive' };
    }
    if (correlationId) {
      syncWhere.correlationId = { contains: correlationId, mode: 'insensitive' };
    }
    if (search) {
      syncWhere.OR = [
        { message: { contains: search, mode: 'insensitive' } },
        { eventType: { contains: search, mode: 'insensitive' } },
        { metaErrorMessage: { contains: search, mode: 'insensitive' } },
      ];
      auditWhere.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // If severity is not INFO, AuditLogs are excluded from 'all' since AuditLog is always INFO
    const includeAudit = !severity || severity === 'INFO';
    const includeSync = !moduleFilter || moduleFilter !== 'USER_ACTION';

    let syncCount = 0;
    let auditCount = 0;
    let rawSync: Array<Prisma.SyncLogGetPayload<Record<string, never>>> = [];
    let rawAudit: Array<Prisma.AuditLogGetPayload<{ include: { user: { select: { name: true; email: true; role: true } } } }>> = [];
    let migrationNeeded = false;

    if (includeAudit) {
      auditCount = await prisma.auditLog.count({ where: auditWhere });
    }
    if (includeSync) {
      try {
        syncCount = await prisma.syncLog.count({ where: syncWhere });
      } catch {
        migrationNeeded = true;
        syncCount = 0;
      }
    }

    const total = syncCount + auditCount;

    // Fetch up to skip + limit from both sources, merge, sort, slice
    const fetchLimit = Math.min(skip + limit, 200);

    const [syncResults, auditResults] = await Promise.all([
      includeSync && !migrationNeeded
        ? prisma.syncLog
            .findMany({
              where: syncWhere,
              orderBy: { createdAt: 'desc' },
              take: fetchLimit,
            })
            .catch(() => [])
        : Promise.resolve([]),
      includeAudit
        ? prisma.auditLog.findMany({
            where: auditWhere,
            orderBy: { createdAt: 'desc' },
            take: fetchLimit,
            include: {
              user: {
                select: { name: true, email: true, role: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    rawSync = syncResults as Array<Prisma.SyncLogGetPayload<Record<string, never>>>;
    rawAudit = auditResults;

    const unifiedList = [
      ...rawSync.map(s => ({
        ...s,
        source: 'SYNC_LOG',
      })),
      ...rawAudit.map(a => ({
        id: a.id,
        source: 'AUDIT_LOG',
        severity: 'INFO',
        module: 'USER_ACTION',
        eventType: a.action,
        message: `Thao tác: ${a.action} trên ${a.entityType} (${a.entityId})`,
        actor: a.user?.name || a.user?.email || 'Hệ thống (System)',
        adAccountId: a.entityType === 'AdAccount' ? a.entityId : null,
        syncJobId: a.entityType === 'SyncJob' ? a.entityId : null,
        beforeJson: a.beforeJson ? sanitizeString(a.beforeJson) : null,
        afterJson: a.afterJson ? sanitizeString(a.afterJson) : null,
        createdAt: a.createdAt,
        user: a.user,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const pagedLogs = unifiedList.slice(skip, skip + limit);

    return NextResponse.json({
      success: true,
      tab,
      logs: pagedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: unknown) {
    console.error('List audit logs failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
