import { prisma } from '@/lib/db';
import {
  MetaApiService,
  MetaConnectionParam,
  normalizeAdAccountId,
  isMockToken,
} from '@/lib/meta';
import { Logger, LogContext, generateCorrelationId } from '@/lib/logger';
import { splitDateRangeToDays, normalizeSyncDate } from '@/lib/sync/metaSyncEngine';
import { CheckpointManager } from '@/lib/sync/checkpointManager';

export type ReconciliationStatus = 'MATCH' | 'MISMATCH' | 'INCOMPLETE' | 'ERROR';

export interface MetricComparison {
  meta: number;
  neon: number;
  difference: number;
  differencePct: number;
  match: boolean;
}

export interface DateReconciliationItem {
  date: string;
  status: 'MATCH' | 'MISMATCH' | 'INCOMPLETE' | 'EMPTY_DAY';
  spend: MetricComparison;
  impressions: MetricComparison;
  clicks: MetricComparison;
  neonInsightsCount: number;
  isEmptyDay: boolean;
  notes?: string;
}

export interface IntegrityCheckResult {
  hasDuplicates: boolean;
  duplicateCount: number;
  duplicateSamples: Array<{ adId: string; date: string; count: number }>;
  missingDates: string[];
  unexpectedDates: string[];
  accountMatch: boolean;
  notes: string[];
}

export interface ReconciliationResult {
  success: boolean;
  overallStatus: ReconciliationStatus;
  adAccountId: string;
  dateRange: {
    dateFrom: string;
    dateTo: string;
    totalDays: number;
  };
  totals: {
    spend: MetricComparison;
    impressions: MetricComparison;
    clicks: MetricComparison;
    neonInsightsCount: number;
  };
  dailyBreakdown: DateReconciliationItem[];
  integrity: IntegrityCheckResult;
  verifiedAt: string;
  durationMs: number;
  error?: string;
  correlationId?: string;
}

export interface ReconcileOptions {
  adAccountId: string;
  dateFrom: string;
  dateTo: string;
  correlationId?: string;
  actor?: string;
}

/**
 * Calculates percentage difference safely with zero-division handling.
 */
function calculatePctDifference(neonVal: number, metaVal: number): number {
  if (metaVal === 0 && neonVal === 0) return 0;
  if (metaVal === 0 && neonVal !== 0) return 100;
  return parseFloat((((neonVal - metaVal) / metaVal) * 100).toFixed(2));
}

/**
 * Task 2.5: Independent Data Reconciliation Engine
 * Reconciles ad-level Daily Insights in Neon PostgreSQL with independent account-level
 * metrics directly fetched from Meta Marketing API.
 */
export class ReconciliationEngine {
  public static async reconcile(
    connection: MetaConnectionParam & { id: string },
    options: ReconcileOptions
  ): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const correlationId = options.correlationId || generateCorrelationId();
    const actor = options.actor || 'system';
    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);

    const dateFrom = normalizeSyncDate(options.dateFrom, '2026-10-01');
    const dateTo = normalizeSyncDate(options.dateTo, '2026-10-31');
    const requestedDates = splitDateRangeToDays(dateFrom, dateTo);

    const ctx: LogContext = {
      correlationId,
      adAccountId: normalizedAccountId,
      reportingDateFrom: new Date(`${dateFrom}T00:00:00.000Z`),
      reportingDateTo: new Date(`${dateTo}T23:59:59.999Z`),
    };

    // 1. Structured Logging: ReconciliationStarted
    await Logger.info(
      'SYNC_ENGINE',
      'ReconciliationStarted',
      `Bắt đầu đối soát dữ liệu cho tài khoản ${normalizedAccountId} từ ${dateFrom} đến ${dateTo}`,
      ctx,
      {
        stage: 'reconciliation_init',
        actor,
        metadata: { dateFrom, dateTo, totalDays: requestedDates.length },
      }
    );

    try {
      // 2. Validate Token and Account
      const decryptedToken = MetaApiService.getDecryptedToken(connection);
      if (isMockToken(decryptedToken) && process.env.NODE_ENV !== 'test') {
        throw new Error('Không thể đối soát với Token Demo (MOCK). Vui lòng cập nhật User Access Token thật từ Meta.');
      }

      // 3. Step 1: Retrieve independent account-level daily metrics directly from Meta
      // Uses level='account' and time_increment='1'
      const metaDailyResult = await MetaApiService.getInsightsPaged(
        normalizedAccountId,
        connection,
        'account',
        dateFrom,
        dateTo,
        { limit: 100, maxPages: 100 }
      );

      const metaDailyMap = new Map<string, { spend: number; impressions: number; clicks: number }>();
      for (const record of metaDailyResult.data) {
        if (record.date_start) {
          metaDailyMap.set(record.date_start, {
            spend: Math.round(parseFloat(record.spend || '0')),
            impressions: parseInt(record.impressions || '0', 10),
            clicks: parseInt(record.clicks || '0', 10),
          });
        }
      }

      // Step 1b: Retrieve independent account-level summary total from Meta directly
      const metaAccountSummary = await MetaApiService.getAccountInsights(
        normalizedAccountId,
        connection,
        dateFrom,
        dateTo
      );

      // In case getAccountInsights returns null or matches sum of dailies
      let metaTotalSpend = 0;
      let metaTotalImpressions = 0;
      let metaTotalClicks = 0;

      if (metaAccountSummary) {
        metaTotalSpend = Math.round(parseFloat(metaAccountSummary.spend || '0'));
        metaTotalImpressions = parseInt(metaAccountSummary.impressions || '0', 10);
        metaTotalClicks = parseInt(metaAccountSummary.clicks || '0', 10);
      } else {
        // Fallback to sum of daily Meta records
        for (const m of metaDailyMap.values()) {
          metaTotalSpend += m.spend;
          metaTotalImpressions += m.impressions;
          metaTotalClicks += m.clicks;
        }
      }

      // 4. Step 2: Retrieve stored ad-level Daily Insights from Neon PostgreSQL
      const dateStartObj = new Date(`${dateFrom}T00:00:00.000Z`);
      const dateEndObj = new Date(`${dateTo}T23:59:59.999Z`);

      const neonStoredInsights = await prisma.insightsDaily.findMany({
        where: {
          adAccount: { accountId: normalizedAccountId },
          date: { gte: dateStartObj, lte: dateEndObj },
          level: 'ad',
        },
        select: {
          id: true,
          date: true,
          spend: true,
          impressions: true,
          clicks: true,
          adId: true,
          level: true,
        },
      });

      // Aggregate stored Neon records by reporting date
      const neonDailyMap = new Map<
        string,
        { spend: number; impressions: number; clicks: number; recordCount: number }
      >();

      let neonTotalSpend = 0;
      let neonTotalImpressions = 0;
      let neonTotalClicks = 0;

      for (const rec of neonStoredInsights) {
        const dStr = rec.date.toISOString().split('T')[0];
        const sp = rec.spend || 0;
        const imp = rec.impressions || 0;
        const clk = rec.clicks || 0;

        neonTotalSpend += sp;
        neonTotalImpressions += imp;
        neonTotalClicks += clk;

        const current = neonDailyMap.get(dStr) || { spend: 0, impressions: 0, clicks: 0, recordCount: 0 };
        current.spend += sp;
        current.impressions += imp;
        current.clicks += clk;
        current.recordCount += 1;
        neonDailyMap.set(dStr, current);
      }

      // Round total spend to integer currency unit (VND)
      neonTotalSpend = Math.round(neonTotalSpend);

      // 5. Checkpoints Lookup to verify date completion status
      const checkpoints = await CheckpointManager.getVerifiedCheckpoints(
        normalizedAccountId,
        requestedDates
      );

      // 6. Data Integrity Check: Duplicate detection & missing dates
      const adDateKeyCount = new Map<string, number>();
      const duplicateSamples: Array<{ adId: string; date: string; count: number }> = [];

      for (const rec of neonStoredInsights) {
        const dStr = rec.date.toISOString().split('T')[0];
        const key = `${dStr}_${rec.level}_${rec.adId}`;
        const cnt = (adDateKeyCount.get(key) || 0) + 1;
        adDateKeyCount.set(key, cnt);
        if (cnt === 2) {
          duplicateSamples.push({ adId: rec.adId, date: dStr, count: cnt });
        }
      }

      const hasDuplicates = duplicateSamples.length > 0;
      const missingDates: string[] = [];
      const unexpectedDates: string[] = [];

      for (const reqDate of requestedDates) {
        const neonData = neonDailyMap.get(reqDate);
        const cp = checkpoints.completedMap.get(reqDate);

        // If date has 0 records and is not a verified empty day
        if (!neonData && (!cp || !cp.isEmptyDay)) {
          missingDates.push(reqDate);
        }
      }

      // Check for dates outside the requested window
      for (const storedDate of neonDailyMap.keys()) {
        if (!requestedDates.includes(storedDate)) {
          unexpectedDates.push(storedDate);
        }
      }

      const integrityNotes: string[] = [];
      if (hasDuplicates) {
        integrityNotes.push(`Phát hiện ${duplicateSamples.length} bản ghi bị trùng lặp logic theo (date, level, adId).`);
      }
      if (missingDates.length > 0) {
        integrityNotes.push(`Có ${missingDates.length} ngày chưa có dữ liệu hợp lệ: ${missingDates.join(', ')}.`);
      }
      if (unexpectedDates.length > 0) {
        integrityNotes.push(`Có ${unexpectedDates.length} ngày nằm ngoài khoảng yêu cầu: ${unexpectedDates.join(', ')}.`);
      }
      if (integrityNotes.length === 0) {
        integrityNotes.push('Kiểm tra toàn vẹn đạt chuẩn: Không trùng lặp, không thất thoát ngày.');
      }

      // 7. Date-Level Comparison
      let hasDailyMismatch = false;
      const dailyBreakdown: DateReconciliationItem[] = [];

      for (const reqDate of requestedDates) {
        const metaDay = metaDailyMap.get(reqDate) || { spend: 0, impressions: 0, clicks: 0 };
        const neonDay = neonDailyMap.get(reqDate) || { spend: 0, impressions: 0, clicks: 0, recordCount: 0 };
        const cp = checkpoints.completedMap.get(reqDate);
        const isEmptyDay = Boolean(cp?.isEmptyDay || (metaDay.spend === 0 && neonDay.spend === 0 && neonDay.recordCount === 0));

        const neonDaySpend = Math.round(neonDay.spend);
        const spendDiff = neonDaySpend - metaDay.spend;
        const impressionsDiff = neonDay.impressions - metaDay.impressions;
        const clicksDiff = neonDay.clicks - metaDay.clicks;

        const spendMatch = spendDiff === 0;
        const impMatch = impressionsDiff === 0;
        const clkMatch = clicksDiff === 0;

        let dayStatus: DateReconciliationItem['status'] = 'MATCH';
        if (missingDates.includes(reqDate)) {
          dayStatus = 'INCOMPLETE';
        } else if (isEmptyDay && spendMatch && impMatch && clkMatch) {
          dayStatus = 'EMPTY_DAY';
        } else if (!spendMatch || !impMatch || !clkMatch) {
          dayStatus = 'MISMATCH';
          hasDailyMismatch = true;
        }

        dailyBreakdown.push({
          date: reqDate,
          status: dayStatus,
          spend: {
            meta: metaDay.spend,
            neon: neonDaySpend,
            difference: spendDiff,
            differencePct: calculatePctDifference(neonDaySpend, metaDay.spend),
            match: spendMatch,
          },
          impressions: {
            meta: metaDay.impressions,
            neon: neonDay.impressions,
            difference: impressionsDiff,
            differencePct: calculatePctDifference(neonDay.impressions, metaDay.impressions),
            match: impMatch,
          },
          clicks: {
            meta: metaDay.clicks,
            neon: neonDay.clicks,
            difference: clicksDiff,
            differencePct: calculatePctDifference(neonDay.clicks, metaDay.clicks),
            match: clkMatch,
          },
          neonInsightsCount: neonDay.recordCount,
          isEmptyDay,
          notes: !spendMatch || !impMatch || !clkMatch
            ? `Chênh lệch: Spend (${spendDiff} VND), Imp (${impressionsDiff}), Clicks (${clicksDiff})`
            : undefined,
        });
      }

      // 8. Overall Comparison
      const totalSpendDiff = neonTotalSpend - metaTotalSpend;
      const totalImpDiff = neonTotalImpressions - metaTotalImpressions;
      const totalClicksDiff = neonTotalClicks - metaTotalClicks;

      const totalSpendMatch = totalSpendDiff === 0;
      const totalImpMatch = totalImpDiff === 0;
      const totalClicksMatch = totalClicksDiff === 0;

      // Determine Overall Status:
      // Even if totals match (e.g. offsetting errors), if any daily mismatch exists, overall status MUST BE MISMATCH!
      let overallStatus: ReconciliationStatus = 'MATCH';
      if (missingDates.length > 0) {
        overallStatus = 'INCOMPLETE';
      } else if (hasDailyMismatch || !totalSpendMatch || !totalImpMatch || !totalClicksMatch || hasDuplicates) {
        overallStatus = 'MISMATCH';
      } else {
        overallStatus = 'MATCH';
      }

      const durationMs = Date.now() - startTime;

      const result: ReconciliationResult = {
        success: true,
        overallStatus,
        adAccountId: normalizedAccountId,
        dateRange: {
          dateFrom,
          dateTo,
          totalDays: requestedDates.length,
        },
        totals: {
          spend: {
            meta: metaTotalSpend,
            neon: neonTotalSpend,
            difference: totalSpendDiff,
            differencePct: calculatePctDifference(neonTotalSpend, metaTotalSpend),
            match: totalSpendMatch,
          },
          impressions: {
            meta: metaTotalImpressions,
            neon: neonTotalImpressions,
            difference: totalImpDiff,
            differencePct: calculatePctDifference(neonTotalImpressions, metaTotalImpressions),
            match: totalImpMatch,
          },
          clicks: {
            meta: metaTotalClicks,
            neon: neonTotalClicks,
            difference: totalClicksDiff,
            differencePct: calculatePctDifference(neonTotalClicks, metaTotalClicks),
            match: totalClicksMatch,
          },
          neonInsightsCount: neonStoredInsights.length,
        },
        dailyBreakdown,
        integrity: {
          hasDuplicates,
          duplicateCount: duplicateSamples.length,
          duplicateSamples,
          missingDates,
          unexpectedDates,
          accountMatch: true,
          notes: integrityNotes,
        },
        verifiedAt: new Date().toISOString(),
        durationMs,
        correlationId,
      };

      // 8b. Persist reconciliation evidence into SyncCheckpoint.metadataJson (Zero schema changes)
      const verifiedAtIso = result.verifiedAt;
      for (const item of dailyBreakdown) {
        try {
          const cp = checkpoints.completedMap.get(item.date);
          const existingMeta = (cp?.metadata && typeof cp.metadata === 'object') ? (cp.metadata as Record<string, unknown>) : {};
          const updatedMeta = {
            ...existingMeta,
            reconciliation: {
              status: item.status,
              verifiedAt: verifiedAtIso,
              spendDiff: item.spend.difference,
              impressionsDiff: item.impressions.difference,
              clicksDiff: item.clicks.difference,
              metaSpend: item.spend.meta,
              neonSpend: item.spend.neon,
            },
          };
          await prisma.syncCheckpoint.updateMany({
            where: {
              adAccountId: normalizedAccountId,
              reportingDate: item.date,
            },
            data: {
              metadataJson: JSON.stringify(updatedMeta),
            },
          });
        } catch {
          // Non-blocking in case of mock/read-only test environment
        }
      }

      // 9. Structured Logging of Results
      if (overallStatus === 'MATCH') {
        await Logger.info(
          'SYNC_ENGINE',
          'ReconciliationCompleted',
          `Đối soát THÀNH CÔNG (MATCH) cho tài khoản ${normalizedAccountId} (${dateFrom} -> ${dateTo}): Toàn bộ ${requestedDates.length} ngày và 3 chỉ số khớp 100%.`,
          ctx,
          {
            stage: 'reconciliation_result',
            durationMs,
            actor,
            recordCount: neonStoredInsights.length,
            metadata: {
              overallStatus,
              metaSpend: metaTotalSpend,
              neonSpend: neonTotalSpend,
              metaImpressions: metaTotalImpressions,
              neonImpressions: neonTotalImpressions,
              metaClicks: metaTotalClicks,
              neonClicks: neonTotalClicks,
            },
          }
        );
      } else {
        await Logger.warn(
          'SYNC_ENGINE',
          'ReconciliationMismatchDetected',
          `Phát hiện SAI LỆCH (${overallStatus}) cho tài khoản ${normalizedAccountId} (${dateFrom} -> ${dateTo}): ` +
            `Spend diff: ${totalSpendDiff} VND, Imp diff: ${totalImpDiff}, Clicks diff: ${totalClicksDiff}, Missing dates: ${missingDates.length}`,
          ctx,
          {
            stage: 'reconciliation_result',
            durationMs,
            actor,
            recordCount: neonStoredInsights.length,
            metadata: {
              overallStatus,
              totalSpendDiff,
              totalImpDiff,
              totalClicksDiff,
              missingDates,
              hasDuplicates,
            },
          }
        );
      }

      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);

      await Logger.error(
        'SYNC_ENGINE',
        'ReconciliationFailed',
        `Thất bại khi thực hiện đối soát cho tài khoản ${normalizedAccountId}: ${errMsg}`,
        ctx,
        {
          stage: 'reconciliation_error',
          durationMs,
          actor,
          metadata: { error: errMsg },
        }
      );

      return {
        success: false,
        overallStatus: 'ERROR',
        adAccountId: normalizedAccountId,
        dateRange: { dateFrom, dateTo, totalDays: requestedDates.length },
        totals: {
          spend: { meta: 0, neon: 0, difference: 0, differencePct: 0, match: false },
          impressions: { meta: 0, neon: 0, difference: 0, differencePct: 0, match: false },
          clicks: { meta: 0, neon: 0, difference: 0, differencePct: 0, match: false },
          neonInsightsCount: 0,
        },
        dailyBreakdown: [],
        integrity: {
          hasDuplicates: false,
          duplicateCount: 0,
          duplicateSamples: [],
          missingDates: requestedDates,
          unexpectedDates: [],
          accountMatch: false,
          notes: [`Lỗi đối soát: ${errMsg}`],
        },
        verifiedAt: new Date().toISOString(),
        durationMs,
        error: errMsg,
        correlationId,
      };
    }
  }
}
