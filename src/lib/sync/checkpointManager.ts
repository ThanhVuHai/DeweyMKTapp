import { prisma } from '@/lib/db';
import { Logger, LogContext } from '@/lib/logger';
import { classifyMetaError, MetaApiError } from '@/lib/meta';

export interface CheckpointRecord {
  reportingDate: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PENDING' | 'UNPROCESSED';
  attemptCount: number;
  completedAt: Date | null;
  recordCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  isEmptyDay: boolean;
  lastError: string | null;
  retryEligible: boolean;
  nextEligibleAt: Date | null;
  syncJobId: string;
  metadata?: Record<string, unknown>;
}

export interface VerifiedCheckpointsResult {
  completedMap: Map<string, CheckpointRecord>;
  completedDates: string[];
  pendingDates: string[];
  failedDates: Array<{ date: string; error: string; nextEligibleAt: Date | null; retryEligible: boolean }>;
  allDates: string[];
  totalCompletedSpend: number;
  totalCompletedImpressions: number;
  totalCompletedClicks: number;
  totalCompletedInsights: number;
}

export class CheckpointManager {
  /**
   * Recovers verified checkpoints for a given account and list of dates.
   * Dual-layer approach:
   * 1. Inspects primary SyncCheckpoint table.
   * 2. If table is empty or legacy job is being resumed (like Job 47dcdfb6),
   *    inspects SyncLog (DailyChunkCompleted, SyncJobPartial) and cross-verifies with InsightsDaily / empty days.
   */
  public static async getVerifiedCheckpoints(
    adAccountId: string,
    dates: string[],
    parentJobId?: string,
    ctx?: LogContext
  ): Promise<VerifiedCheckpointsResult> {
    const completedMap = new Map<string, CheckpointRecord>();
    const pendingDates: string[] = [];
    const failedDates: Array<{ date: string; error: string; nextEligibleAt: Date | null; retryEligible: boolean }> = [];

    let totalCompletedSpend = 0;
    let totalCompletedImpressions = 0;
    let totalCompletedClicks = 0;
    let totalCompletedInsights = 0;

    // 1. Try reading from primary SyncCheckpoint table
    let dbCheckpoints: CheckpointRecord[] = [];
    try {
      const records = await prisma.syncCheckpoint.findMany({
        where: {
          adAccountId,
          reportingDate: { in: dates },
        },
      });

      dbCheckpoints = records.map(r => ({
        reportingDate: r.reportingDate,
        status: r.status as CheckpointRecord['status'],
        attemptCount: r.attemptCount,
        completedAt: r.completedAt,
        recordCount: r.recordCount,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        isEmptyDay: r.isEmptyDay,
        lastError: r.lastError,
        retryEligible: r.retryEligible,
        nextEligibleAt: r.nextEligibleAt,
        syncJobId: r.syncJobId,
        metadata: r.metadataJson ? JSON.parse(r.metadataJson) : undefined,
      }));

      for (const cp of dbCheckpoints) {
        if (cp.status === 'SUCCESS') {
          completedMap.set(cp.reportingDate, cp);
          totalCompletedSpend += cp.spend;
          totalCompletedImpressions += cp.impressions;
          totalCompletedClicks += cp.clicks;
          totalCompletedInsights += cp.recordCount;
        } else if (cp.status === 'FAILED') {
          failedDates.push({
            date: cp.reportingDate,
            error: cp.lastError || 'Lỗi không xác định',
            nextEligibleAt: cp.nextEligibleAt,
            retryEligible: cp.retryEligible,
          });
        }
      }
    } catch {
      // Table may not exist yet or local SQLite test environment
    }

    // 2. Fallback / Legacy Job Recovery Layer (e.g. for Job 47dcdfb6 or when SyncCheckpoint is sparse)
    // Check if dates are missing from completedMap. If so, inspect SyncLog & InsightsDaily
    const missingDates = dates.filter(d => !completedMap.has(d));
    if (missingDates.length > 0) {
      try {
        const recoveredFromLogs = await this.recoverFromLogsAndStorage(adAccountId, missingDates, parentJobId);
        for (const [date, cp] of recoveredFromLogs.entries()) {
          completedMap.set(date, cp);
          totalCompletedSpend += cp.spend;
          totalCompletedImpressions += cp.impressions;
          totalCompletedClicks += cp.clicks;
          totalCompletedInsights += cp.recordCount;

          // Attempt to persist back to SyncCheckpoint so subsequent lookups are O(1)
          try {
            await prisma.syncCheckpoint.upsert({
              where: {
                adAccountId_reportingDate: {
                  adAccountId,
                  reportingDate: date,
                },
              },
              update: {
                status: 'SUCCESS',
                completedAt: cp.completedAt || new Date(),
                recordCount: cp.recordCount,
                spend: cp.spend,
                impressions: cp.impressions,
                clicks: cp.clicks,
                isEmptyDay: cp.isEmptyDay,
                retryEligible: false,
                lastError: null,
                syncJobId: cp.syncJobId,
              },
              create: {
                adAccountId,
                syncJobId: cp.syncJobId,
                reportingDate: date,
                status: 'SUCCESS',
                completedAt: cp.completedAt || new Date(),
                recordCount: cp.recordCount,
                spend: cp.spend,
                impressions: cp.impressions,
                clicks: cp.clicks,
                isEmptyDay: cp.isEmptyDay,
                retryEligible: false,
                lastError: null,
              },
            });
          } catch {
            // Safe ignore if DB table not yet migrated
          }
        }
      } catch (err: unknown) {
        if (ctx) {
          Logger.warn(
            'SYNC_ENGINE',
            'CheckpointFallbackWarning',
            `Không thể phục hồi từ SyncLog: ${(err as Error).message}`,
            ctx
          );
        }
      }
    }

    // 3. Partition dates into completed vs pending vs failed
    for (const d of dates) {
      if (!completedMap.has(d)) {
        const failedEntry = failedDates.find(f => f.date === d);
        if (failedEntry) {
          // If nextEligibleAt is in the future, it cannot be retried yet
          if (failedEntry.retryEligible && (!failedEntry.nextEligibleAt || Date.now() >= failedEntry.nextEligibleAt.getTime())) {
            pendingDates.push(d);
          }
        } else {
          pendingDates.push(d);
        }
      }
    }

    return {
      completedMap,
      completedDates: Array.from(completedMap.keys()).sort(),
      pendingDates: pendingDates.sort(),
      failedDates,
      allDates: dates,
      totalCompletedSpend: Math.round(totalCompletedSpend),
      totalCompletedImpressions,
      totalCompletedClicks,
      totalCompletedInsights,
    };
  }

  /**
   * Recovers verified completed dates from SyncLog events and validates against InsightsDaily / empty day logs.
   * Specially designed for Test A (recovering Job 47dcdfb6 where Oct 1-21 completed).
   */
  private static async recoverFromLogsAndStorage(
    adAccountId: string,
    targetDates: string[],
    parentJobId?: string
  ): Promise<Map<string, CheckpointRecord>> {
    const recovered = new Map<string, CheckpointRecord>();

    // 1. Query SyncLog for DailyChunkCompleted events
    const whereClause: Record<string, unknown> = {
      module: 'SYNC_ENGINE',
      eventType: 'DailyChunkCompleted',
      adAccountId,
    };
    if (parentJobId) {
      whereClause.syncJobId = parentJobId;
    }

    const logRecords = await prisma.syncLog.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const log of logRecords) {
      let repDate: string | null = null;
      let spend = 0;
      let impressions = 0;
      let clicks = 0;
      let isEmptyDay = false;
      const recordCount = log.recordCount || 0;

      if (log.sanitizedMeta && typeof log.sanitizedMeta === 'object') {
        const meta = log.sanitizedMeta as Record<string, unknown>;
        if (typeof meta.reportingDate === 'string') {
          repDate = meta.reportingDate;
        }
        if (typeof meta.spend === 'number') spend = meta.spend;
        if (typeof meta.impressions === 'number') impressions = meta.impressions;
        if (typeof meta.clicks === 'number') clicks = meta.clicks;
        if (typeof meta.isEmptyDay === 'boolean') isEmptyDay = meta.isEmptyDay;
      }

      if (!repDate && log.reportingDateFrom) {
        repDate = log.reportingDateFrom.toISOString().split('T')[0];
      }

      if (repDate && targetDates.includes(repDate) && !recovered.has(repDate)) {
        recovered.set(repDate, {
          reportingDate: repDate,
          status: 'SUCCESS',
          attemptCount: 1,
          completedAt: log.createdAt,
          recordCount,
          spend,
          impressions,
          clicks,
          isEmptyDay,
          lastError: null,
          retryEligible: false,
          nextEligibleAt: null,
          syncJobId: log.syncJobId || parentJobId || 'legacy_job',
        });
      }
    }

    // 2. Also check if SyncJobPartial or SyncJobCompleted has successfulDates in sanitizedMeta
    const parentJobLogs = await prisma.syncLog.findMany({
      where: {
        module: 'SYNC_ENGINE',
        eventType: { in: ['SyncJobPartial', 'SyncJobCompleted'] },
        adAccountId,
        ...(parentJobId ? { syncJobId: parentJobId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    for (const pLog of parentJobLogs) {
      if (pLog.sanitizedMeta && typeof pLog.sanitizedMeta === 'object') {
        const pMeta = pLog.sanitizedMeta as Record<string, unknown>;
        if (Array.isArray(pMeta.successfulDates)) {
          for (const sDate of pMeta.successfulDates) {
            if (typeof sDate === 'string' && targetDates.includes(sDate) && !recovered.has(sDate)) {
              recovered.set(sDate, {
                reportingDate: sDate,
                status: 'SUCCESS',
                attemptCount: 1,
                completedAt: pLog.createdAt,
                recordCount: 0,
                spend: 0,
                impressions: 0,
                clicks: 0,
                isEmptyDay: false,
                lastError: null,
                retryEligible: false,
                nextEligibleAt: null,
                syncJobId: pLog.syncJobId || parentJobId || 'legacy_job',
              });
            }
          }
        }
      }
    }

    // 3. For any date marked recovered, verify either isEmptyDay or InsightsDaily records
    for (const [date, cp] of Array.from(recovered.entries())) {
      if (cp.recordCount === 0 && !cp.isEmptyDay) {
        // Query database to get actual stored metrics for this date
        const dateStart = new Date(`${date}T00:00:00.000Z`);
        const dateEnd = new Date(`${date}T23:59:59.999Z`);
        const dbAgg = await prisma.insightsDaily.aggregate({
          where: {
            adAccount: { accountId: adAccountId },
            date: { gte: dateStart, lte: dateEnd },
          },
          _count: { id: true },
          _sum: { spend: true, impressions: true, clicks: true },
        });

        const cnt = dbAgg._count.id;
        if (cnt > 0) {
          cp.recordCount = cnt;
          cp.spend = Math.round(dbAgg._sum.spend || 0);
          cp.impressions = dbAgg._sum.impressions || 0;
          cp.clicks = dbAgg._sum.clicks || 0;
        } else {
          // If no records in InsightsDaily and not explicitly marked isEmptyDay,
          // do NOT guess! Keep it only if confirmed by DailyChunkCompleted event
          const hasChunkLog = logRecords.some(l => {
            const m = l.sanitizedMeta as Record<string, unknown> | null;
            return m?.reportingDate === date;
          });
          if (!hasChunkLog) {
            recovered.delete(date);
          } else {
            cp.isEmptyDay = true;
          }
        }
      }
    }

    return recovered;
  }

  /**
   * Records that a daily chunk is starting execution.
   */
  public static async recordChunkRunning(
    adAccountId: string,
    syncJobId: string,
    reportingDate: string
  ): Promise<void> {
    try {
      await prisma.syncCheckpoint.upsert({
        where: {
          adAccountId_reportingDate: {
            adAccountId,
            reportingDate,
          },
        },
        update: {
          status: 'RUNNING',
          syncJobId,
          attemptCount: { increment: 1 },
        },
        create: {
          adAccountId,
          syncJobId,
          reportingDate,
          status: 'RUNNING',
          attemptCount: 1,
        },
      });
    } catch {
      // Safe fallback
    }
  }

  /**
   * Persists a successful daily chunk checkpoint consistently with advertising data persistence.
   */
  public static async recordChunkSuccess(
    adAccountId: string,
    syncJobId: string,
    reportingDate: string,
    data: {
      recordCount: number;
      spend: number;
      impressions: number;
      clicks: number;
      isEmptyDay: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      await prisma.syncCheckpoint.upsert({
        where: {
          adAccountId_reportingDate: {
            adAccountId,
            reportingDate,
          },
        },
        update: {
          status: 'SUCCESS',
          syncJobId,
          completedAt: new Date(),
          recordCount: data.recordCount,
          spend: data.spend,
          impressions: data.impressions,
          clicks: data.clicks,
          isEmptyDay: data.isEmptyDay,
          lastError: null,
          retryEligible: false,
          nextEligibleAt: null,
          metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
        },
        create: {
          adAccountId,
          syncJobId,
          reportingDate,
          status: 'SUCCESS',
          completedAt: new Date(),
          recordCount: data.recordCount,
          spend: data.spend,
          impressions: data.impressions,
          clicks: data.clicks,
          isEmptyDay: data.isEmptyDay,
          lastError: null,
          retryEligible: false,
          nextEligibleAt: null,
          metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
        },
      });
    } catch {
      // Safe fallback
    }
  }

  /**
   * Records a failed daily chunk checkpoint with error classification,
   * retry eligibility and next eligible execution time (Deferred Recovery).
   */
  public static async recordChunkFailure(
    adAccountId: string,
    syncJobId: string,
    reportingDate: string,
    error: unknown,
    attemptCount: number = 1
  ): Promise<void> {
    const errMsg = error instanceof Error ? error.message : String(error);
    const classification = classifyMetaError(error);
    const isPermanent = classification === 'PERMANENT';

    const retryEligible = !isPermanent && attemptCount < 5;
    let nextEligibleAt: Date | null = null;

    if (retryEligible) {
      let waitSeconds = 30;
      if (error instanceof MetaApiError && error.rateLimitMetadata?.retryAfterSeconds) {
        waitSeconds = error.rateLimitMetadata.retryAfterSeconds;
      } else if (classification === 'META_ERROR_2') {
        waitSeconds = Math.min(300, 15 * Math.pow(2, attemptCount));
      } else {
        waitSeconds = Math.min(300, 10 * Math.pow(2, attemptCount));
      }
      nextEligibleAt = new Date(Date.now() + waitSeconds * 1000);
    }

    try {
      await prisma.syncCheckpoint.upsert({
        where: {
          adAccountId_reportingDate: {
            adAccountId,
            reportingDate,
          },
        },
        update: {
          status: 'FAILED',
          syncJobId,
          lastError: errMsg,
          retryEligible,
          nextEligibleAt,
          attemptCount: { increment: 1 },
        },
        create: {
          adAccountId,
          syncJobId,
          reportingDate,
          status: 'FAILED',
          lastError: errMsg,
          retryEligible,
          nextEligibleAt,
          attemptCount,
        },
      });
    } catch {
      // Safe fallback
    }
  }

  /**
   * Records unprocessed dates when execution budget runs low.
   */
  public static async recordChunkUnprocessed(
    adAccountId: string,
    syncJobId: string,
    reportingDate: string
  ): Promise<void> {
    try {
      await prisma.syncCheckpoint.upsert({
        where: {
          adAccountId_reportingDate: {
            adAccountId,
            reportingDate,
          },
        },
        update: {
          status: 'UNPROCESSED',
          syncJobId,
          retryEligible: true,
          nextEligibleAt: new Date(),
        },
        create: {
          adAccountId,
          syncJobId,
          reportingDate,
          status: 'UNPROCESSED',
          retryEligible: true,
          nextEligibleAt: new Date(),
        },
      });
    } catch {
      // Safe fallback
    }
  }
}
