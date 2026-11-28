import { prisma } from '@/lib/db';
import { normalizeAdAccountId } from '@/lib/meta';
import { splitDateRangeToDays, normalizeSyncDate, SYNC_JOB_LEASE_MS } from '@/lib/sync/metaSyncEngine';

export type SyncHealthStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'RUNNING' | 'UNPROCESSED' | 'NONE';

export type VerificationHealthStatus =
  | 'MATCH'
  | 'MISMATCH'
  | 'UNVERIFIED'
  | 'INCOMPLETE'
  | 'VERIFICATION_ERROR';

export type DisplayHealthStatus =
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'MISMATCH'
  | 'FAILED'
  | 'MISSING'
  | 'IN_PROGRESS'
  | 'STALE';

export interface DateHealthItem {
  adAccountId: string;
  reportingDate: string;
  syncStatus: SyncHealthStatus;
  verificationStatus: VerificationHealthStatus;
  displayStatus: DisplayHealthStatus;
  lastSyncAt: string | null;
  lastVerifiedAt: string | null;
  latestJobId: string | null;
  insightsCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  metricDifferences: {
    spendDiff: number;
    impressionsDiff: number;
    clicksDiff: number;
  } | null;
  lastError: string | null;
  retryEligible: boolean;
  nextEligibleAt: string | null;
  isEmptyDay: boolean;
  isFuture: boolean;
  isBeforeStart: boolean;
}

export interface DataHealthSummary {
  totalExpected: number;
  verified: number;
  unverified: number;
  mismatch: number;
  failed: number;
  missing: number;
  inProgress: number;
  stale: number;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalInsights: number;
}

export interface DataHealthResult {
  success: boolean;
  adAccountId: string;
  accountTimezone: string;
  syncStartDate: string;
  dateRange: {
    dateFrom: string;
    dateTo: string;
    totalDays: number;
  };
  summary: DataHealthSummary;
  dates: DateHealthItem[];
  integrity: {
    mixedLevelFiltered: boolean;
    duplicateCount: number;
  };
  checkedAt: string;
}

export interface GetDataHealthOptions {
  adAccountId: string;
  dateFrom: string;
  dateTo: string;
  timezone?: string;
  syncStartDate?: string;
}

/**
 * Task 2.6: Centralized Data Health Monitor Service
 * Analyzes SyncCheckpoint, SyncJob, SyncLog, and InsightsDaily to provide an accurate,
 * independent, date-level health status model without calling Meta API on page load.
 */
export class DataHealthService {
  public static async getDataHealth(
    options: GetDataHealthOptions
  ): Promise<DataHealthResult> {
    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);
    const dateFrom = normalizeSyncDate(options.dateFrom, '2026-10-01');
    const dateTo = normalizeSyncDate(options.dateTo, '2026-10-31');
    const requestedDates = splitDateRangeToDays(dateFrom, dateTo);

    // 1. Resolve Account & Connection timezone + syncStartDate
    let accountTimezone = options.timezone || 'Asia/Ho_Chi_Minh';
    let syncStartDate = options.syncStartDate || '2026-05-15';

    try {
      const dbAccount = await prisma.adAccount.findUnique({
        where: { accountId: normalizedAccountId },
        include: { metaConnection: true },
      });
      if (dbAccount?.timezoneName) {
        accountTimezone = dbAccount.timezoneName;
      }
      if (dbAccount?.metaConnection?.syncStartDate) {
        const rawDate = dbAccount.metaConnection.syncStartDate;
        syncStartDate = rawDate instanceof Date ? rawDate.toISOString().split('T')[0] : String(rawDate);
      }
    } catch {
      // Ignored in test environment
    }

    // Determine current date in account timezone (YYYY-MM-DD)
    let todayInTz: string;
    try {
      todayInTz = new Intl.DateTimeFormat('en-CA', {
        timeZone: accountTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      todayInTz = new Date().toISOString().split('T')[0];
    }

    // 2. Query Stored Ad-level Daily Insights (Section 4: explicitly level = 'ad')
    const dateStartObj = new Date(`${dateFrom}T00:00:00.000Z`);
    const dateEndObj = new Date(`${dateTo}T23:59:59.999Z`);

    let storedInsights: Array<{
      date: Date;
      spend: number;
      impressions: number;
      clicks: number;
      adId: string;
      level: string;
    }> = [];

    try {
      storedInsights = await prisma.insightsDaily.findMany({
        where: {
          adAccount: { accountId: normalizedAccountId },
          date: { gte: dateStartObj, lte: dateEndObj },
          level: 'ad', // Exclude campaign and adset level records
        },
        select: {
          date: true,
          spend: true,
          impressions: true,
          clicks: true,
          adId: true,
          level: true,
        },
      });
    } catch {
      storedInsights = [];
    }

    // Aggregate stored records by date
    const storedDailyMap = new Map<
      string,
      { spend: number; impressions: number; clicks: number; count: number }
    >();

    const adDateKeyCount = new Map<string, number>();
    let duplicateCount = 0;

    for (const rec of storedInsights) {
      const dStr = rec.date.toISOString().split('T')[0];
      const cur = storedDailyMap.get(dStr) || { spend: 0, impressions: 0, clicks: 0, count: 0 };
      cur.spend += rec.spend || 0;
      cur.impressions += rec.impressions || 0;
      cur.clicks += rec.clicks || 0;
      cur.count += 1;
      storedDailyMap.set(dStr, cur);

      // Check logical duplicate (date, adId)
      const key = `${dStr}_${rec.adId}`;
      const cnt = (adDateKeyCount.get(key) || 0) + 1;
      adDateKeyCount.set(key, cnt);
      if (cnt === 2) {
        duplicateCount += 1;
      }
    }

    // 3. Query Checkpoints for the requested dates
    interface CheckpointRow {
      reportingDate: string;
      status: string;
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
      metadataJson: string | null;
      updatedAt: Date;
    }

    const checkpointMap = new Map<string, CheckpointRow>();
    try {
      const cpRecords = await prisma.syncCheckpoint.findMany({
        where: {
          adAccountId: normalizedAccountId,
          reportingDate: { in: requestedDates },
        },
      });
      for (const cp of cpRecords) {
        checkpointMap.set(cp.reportingDate, cp as unknown as CheckpointRow);
      }
    } catch {
      // Ignored if table not yet populated or in mock
    }

    // 4. Query Active Running Jobs (< 330s lease)
    let activeRunningJobId: string | null = null;
    try {
      const leaseThreshold = new Date(Date.now() - SYNC_JOB_LEASE_MS);
      const activeJob = await prisma.syncJob.findFirst({
        where: {
          adAccountId: normalizedAccountId,
          status: 'running',
          startedAt: { gte: leaseThreshold },
        },
        select: { id: true, dateFrom: true, dateTo: true },
      });
      if (activeJob) {
        activeRunningJobId = activeJob.id;
      }
    } catch {
      activeRunningJobId = null;
    }

    // 5. Evaluate Date-Level Health Status for each requested date
    const dateItems: DateHealthItem[] = [];

    let totalExpected = 0;
    let verifiedCount = 0;
    let unverifiedCount = 0;
    let mismatchCount = 0;
    let failedCount = 0;
    let missingCount = 0;
    let inProgressCount = 0;
    let staleCount = 0;

    let overallSpend = 0;
    let overallImp = 0;
    let overallClk = 0;
    let overallInsights = 0;

    for (const curDate of requestedDates) {
      const isFuture = curDate > todayInTz;
      const isBeforeStart = curDate < syncStartDate;

      const stored = storedDailyMap.get(curDate);
      const cp = checkpointMap.get(curDate);

      const dSpend = stored ? Math.round(stored.spend) : (cp?.spend ? Math.round(cp.spend) : 0);
      const dImp = stored ? stored.impressions : (cp?.impressions || 0);
      const dClk = stored ? stored.clicks : (cp?.clicks || 0);
      const dCount = stored ? stored.count : (cp?.recordCount || 0);

      overallSpend += dSpend;
      overallImp += dImp;
      overallClk += dClk;
      overallInsights += dCount;

      const isEmptyDay = Boolean(cp?.isEmptyDay || (dSpend === 0 && dImp === 0 && dClk === 0 && dCount === 0 && cp?.status === 'SUCCESS'));

      // Determine Sync Status
      let syncStatus: SyncHealthStatus = 'NONE';
      if (activeRunningJobId) {
        syncStatus = 'RUNNING';
      } else if (cp) {
        syncStatus = (['SUCCESS', 'FAILED', 'PENDING', 'RUNNING', 'UNPROCESSED'].includes(cp.status)
          ? cp.status
          : 'NONE') as SyncHealthStatus;
      } else if (dCount > 0) {
        syncStatus = 'SUCCESS';
      }

      // Determine Verification Status from checkpoint metadata
      let verificationStatus: VerificationHealthStatus = 'UNVERIFIED';
      let lastVerifiedAt: string | null = null;
      let metricDiffs: { spendDiff: number; impressionsDiff: number; clicksDiff: number } | null = null;
      let isStaleVerification = false;

      if (cp?.metadataJson) {
        try {
          const metaParsed = JSON.parse(cp.metadataJson) as Record<string, unknown>;
          if (metaParsed.reconciliation && typeof metaParsed.reconciliation === 'object') {
            const rec = metaParsed.reconciliation as {
              status?: string;
              verifiedAt?: string;
              spendDiff?: number;
              impressionsDiff?: number;
              clicksDiff?: number;
            };

            lastVerifiedAt = rec.verifiedAt || null;
            if (typeof rec.spendDiff === 'number') {
              metricDiffs = {
                spendDiff: rec.spendDiff || 0,
                impressionsDiff: rec.impressionsDiff || 0,
                clicksDiff: rec.clicksDiff || 0,
              };
            }

            // Freshness Invalidation Check (Section 7):
            // If data synchronization completed AFTER reconciliation verification timestamp
            if (cp.completedAt && rec.verifiedAt) {
              const compTime = new Date(cp.completedAt).getTime();
              const verTime = new Date(rec.verifiedAt).getTime();
              // If synchronized newer by more than 2 seconds
              if (compTime > verTime + 2000) {
                isStaleVerification = true;
              }
            }

            if (isStaleVerification) {
              verificationStatus = 'UNVERIFIED';
            } else if (rec.status === 'MATCH' || rec.status === 'EMPTY_DAY') {
              verificationStatus = 'MATCH';
            } else if (rec.status === 'MISMATCH') {
              verificationStatus = 'MISMATCH';
            } else if (rec.status === 'INCOMPLETE') {
              verificationStatus = 'INCOMPLETE';
            } else {
              verificationStatus = 'VERIFICATION_ERROR';
            }
          }
        } catch {
          // Metadata parse failure
        }
      }

      // Determine Display Status (Mutually Exclusive)
      let displayStatus: DisplayHealthStatus;

      if (syncStatus === 'RUNNING') {
        displayStatus = 'IN_PROGRESS';
      } else if (syncStatus === 'FAILED' && dCount === 0 && !isEmptyDay) {
        displayStatus = 'FAILED';
      } else if (!isFuture && !isBeforeStart && dCount === 0 && !isEmptyDay && syncStatus !== 'SUCCESS') {
        displayStatus = 'MISSING';
      } else if (verificationStatus === 'MISMATCH') {
        displayStatus = 'MISMATCH';
      } else if (isStaleVerification) {
        displayStatus = 'STALE';
      } else if (verificationStatus === 'MATCH') {
        displayStatus = 'VERIFIED';
      } else {
        // Successfully synchronized (or empty day), but not yet verified
        displayStatus = 'UNVERIFIED';
      }

      // Summary tallying (only count valid active expected dates)
      if (!isFuture && !isBeforeStart) {
        totalExpected += 1;
        switch (displayStatus) {
          case 'VERIFIED':
            verifiedCount += 1;
            break;
          case 'UNVERIFIED':
            unverifiedCount += 1;
            break;
          case 'MISMATCH':
            mismatchCount += 1;
            break;
          case 'FAILED':
            failedCount += 1;
            break;
          case 'MISSING':
            missingCount += 1;
            break;
          case 'IN_PROGRESS':
            inProgressCount += 1;
            break;
          case 'STALE':
            staleCount += 1;
            break;
        }
      }

      dateItems.push({
        adAccountId: normalizedAccountId,
        reportingDate: curDate,
        syncStatus,
        verificationStatus,
        displayStatus,
        lastSyncAt: cp?.completedAt ? cp.completedAt.toISOString() : null,
        lastVerifiedAt,
        latestJobId: cp?.syncJobId || null,
        insightsCount: dCount,
        spend: dSpend,
        impressions: dImp,
        clicks: dClk,
        metricDifferences: metricDiffs,
        lastError: cp?.lastError || null,
        retryEligible: cp?.retryEligible ?? true,
        nextEligibleAt: cp?.nextEligibleAt ? cp.nextEligibleAt.toISOString() : null,
        isEmptyDay,
        isFuture,
        isBeforeStart,
      });
    }

    return {
      success: true,
      adAccountId: normalizedAccountId,
      accountTimezone,
      syncStartDate,
      dateRange: {
        dateFrom,
        dateTo,
        totalDays: requestedDates.length,
      },
      summary: {
        totalExpected,
        verified: verifiedCount,
        unverified: unverifiedCount,
        mismatch: mismatchCount,
        failed: failedCount,
        missing: missingCount,
        inProgress: inProgressCount,
        stale: staleCount,
        totalSpend: Math.round(overallSpend),
        totalImpressions: overallImp,
        totalClicks: overallClk,
        totalInsights: overallInsights,
      },
      dates: dateItems,
      integrity: {
        mixedLevelFiltered: true,
        duplicateCount,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
