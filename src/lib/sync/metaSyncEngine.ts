import { prisma } from '@/lib/db';
import {
  MetaApiService,
  MetaApiError,
  MetaConnectionParam,
  normalizeAdAccountId,
  isMockToken,
} from '@/lib/meta';
import { assertDatabaseIsolation } from './preflightGuard';
import { Logger, LogContext, generateCorrelationId } from '@/lib/logger';

export interface SyncOptions {
  adAccountId: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  jobType?: 'manual_sync' | 'scheduled_cron';
  maxPages?: number;
  force?: boolean;
  correlationId?: string;
  actor?: string;
}

export interface DailyChunkResult {
  date: string;
  status: 'SUCCESS' | 'FAILED' | 'UNPROCESSED';
  insightsCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  durationMs: number;
  error?: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  metaFbtraceId?: string;
}

export interface DatesSummary {
  totalDates: number;
  successfulCount: number;
  failedCount: number;
  unprocessedCount: number;
  successfulDates: string[];
  failedDates: Array<{
    date: string;
    error: string;
    metaErrorCode?: number;
    metaErrorSubcode?: number;
    metaFbtraceId?: string;
  }>;
  unprocessedDates: string[];
}

export interface SyncResult {
  success: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  jobId: string;
  jobType: string;
  adAccountId: string;
  accountName: string;
  dateRange: { since: string; until: string };
  datesSummary: DatesSummary;
  chunks: DailyChunkResult[];
  counts: {
    campaignsUpserted: number;
    adsetsUpserted: number;
    adsUpserted: number;
    insightsUpserted: number;
  };
  metrics: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
  };
  timings?: Record<string, number>;
  executionTimeMs: number;
  error?: string;
}

export interface StaleJobRecoveryResult {
  recoveredCount: number;
  recoveredJobIds: string[];
}

// Allowed accounts during initial testing (Strict scope control)
export const ENABLED_ACCOUNTS_FOR_SYNC = ['act_1380498158917028', '1380498158917028'];

// Bounded lease for Serverless Execution (330 seconds).
// Matches 300s maxDuration with safe 30s buffer.
export const SYNC_JOB_LEASE_MS = 330 * 1000;

// Maximum execution duration allowance before graceful shutdown (280s out of 300s maxDuration).
export const FUNCTION_TIMEOUT_MS = 280 * 1000;

// Safety execution budget required to safely process another daily chunk (25 seconds).
export const SAFETY_BUDGET_REMAINING_MS = 25 * 1000;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes date string to YYYY-MM-DD format with fallback
 */
export function normalizeSyncDate(dateStr: string | undefined | null, fallbackDate: string): string {
  if (!dateStr || typeof dateStr !== 'string') return fallbackDate;
  const trimmed = dateStr.trim();
  if (!DATE_REGEX.test(trimmed)) return fallbackDate;
  return trimmed;
}

/**
 * Splits a date range [dateFrom, dateTo] into an array of individual dates (YYYY-MM-DD).
 * Ordered chronologically from start to end.
 */
export function splitDateRangeToDays(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const start = new Date(dateFrom + 'T00:00:00.000Z');
  const end = new Date(dateTo + 'T00:00:00.000Z');

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [dateFrom];
  }

  const curr = new Date(start);
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Concurrently processes an array of items in batches of `batchSize`.
 * Drastically reduces round-trip network latency to remote databases.
 */
export async function batchProcess<T, R = void>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map(worker));
    results.push(...chunkResults);
  }
  return results;
}

export class MetaSyncEngine {
  /**
   * Scans for stale or orphaned RUNNING jobs whose execution lease has expired,
   * transitions them to 'timeout', records diagnostic context, and safely unlocks the account.
   */
  public static async recoverStaleJobs(
    adAccountId?: string,
    ctx?: Partial<LogContext>
  ): Promise<StaleJobRecoveryResult> {
    const leaseCutoff = new Date(Date.now() - SYNC_JOB_LEASE_MS);

    // Find jobs that are 'running' but have exceeded the lease
    const staleConditions: Array<Record<string, unknown>> = [
      { startedAt: { lt: leaseCutoff } },
      { startedAt: null, createdAt: { lt: leaseCutoff } },
    ];

    const whereClause: {
      status: string;
      OR: Array<Record<string, unknown>>;
      adAccountId?: string;
    } = {
      status: 'running',
      OR: staleConditions,
    };

    if (adAccountId) {
      whereClause.adAccountId = normalizeAdAccountId(adAccountId);
    }

    try {
      const staleJobs = await prisma.syncJob.findMany({
        where: whereClause,
        select: { id: true, startedAt: true, adAccountId: true, errorMessage: true },
      });

      if (staleJobs.length === 0) {
        return { recoveredCount: 0, recoveredJobIds: [] };
      }

      const now = new Date();
      for (const job of staleJobs) {
        const lastStage = job.errorMessage ? ` [Giai đoạn dừng: ${job.errorMessage}]` : '';
        await prisma.syncJob.update({
          where: { id: job.id },
          data: {
            status: 'timeout',
            finishedAt: now,
            errorMessage: `Tiến trình bị gián đoạn do vượt quá thời hạn thực thi Serverless (${Math.round(
              SYNC_JOB_LEASE_MS / 1000
            )}s lease). Đã tự động thu hồi lock an toàn.${lastStage}`,
          },
        });
      }

      const recoveredJobIds = staleJobs.map(j => j.id);
      console.log(`[MetaSyncEngine] Recovered ${recoveredJobIds.length} stale job(s): ${recoveredJobIds.join(', ')}`);

      // Event 19: Stale job recovered
      await Logger.warn(
        'SYNC_ENGINE',
        'StaleJobRecovered',
        `Đã thu hồi lock an toàn cho ${recoveredJobIds.length} tiến trình quá hạn lease (${Math.round(
          SYNC_JOB_LEASE_MS / 1000
        )}s lease): ${recoveredJobIds.join(', ')}`,
        ctx,
        {
          stage: 'stale_job_recovery',
          recordCount: recoveredJobIds.length,
          metadata: { recoveredJobIds },
        }
      );

      return {
        recoveredCount: recoveredJobIds.length,
        recoveredJobIds,
      };
    } catch (err: unknown) {
      console.error('[MetaSyncEngine] Error during recoverStaleJobs:', err);
      return { recoveredCount: 0, recoveredJobIds: [] };
    }
  }

  /**
   * Synchronizes daily advertising performance and active structure
   * from Meta Marketing API into Neon PostgreSQL using an Insights-First architecture.
   */
  public static async syncAdAccount(
    connection: MetaConnectionParam & { id: string },
    options: SyncOptions
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const timings: Record<string, number> = {};
    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);
    const jobType = options.jobType || 'manual_sync';
    const correlationId = options.correlationId || generateCorrelationId();
    const actor = options.actor || 'system';

    // Resolve date window (Defaults to last 30 days if unspecified)
    const now = new Date();
    const defaultDateTo = now.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultDateFrom = thirtyDaysAgo.toISOString().split('T')[0];

    const dateFrom = normalizeSyncDate(options.dateFrom, defaultDateFrom);
    const dateTo = normalizeSyncDate(options.dateTo, defaultDateTo);

    const ctx: LogContext = {
      correlationId,
      adAccountId: normalizedAccountId,
      reportingDateFrom: new Date(dateFrom),
      reportingDateTo: new Date(dateTo),
    };

    // Event 2: Preflight verification started
    await Logger.info(
      'SYSTEM',
      'PreflightVerificationStarted',
      `Bắt đầu kiểm tra Preflight cho tài khoản ${normalizedAccountId}`,
      ctx,
      { stage: 'preflight_verification', actor }
    );

    // 1. Strict Scope Enforcement
    const isAllowed = ENABLED_ACCOUNTS_FOR_SYNC.includes(normalizedAccountId);
    if (!isAllowed) {
      await Logger.warn(
        'SYSTEM',
        'PreflightVerificationFailed',
        `Tài khoản ${normalizedAccountId} không thuộc danh sách được phép đồng bộ.`,
        ctx,
        { stage: 'preflight_verification', actor }
      );
      throw new Error(
        `Tài khoản ${normalizedAccountId} chưa được bật tính năng đồng bộ tự động. ` +
        `Trong giai đoạn nghiệm thu Stage 1A/Task 2, chỉ tài khoản GIS Hà Nội (act_1380498158917028) được phép đồng bộ.`
      );
    }

    // 2. Database Isolation Guard (Safety First: Never write to Production during Preview testing)
    if (process.env.NODE_ENV !== 'test') {
      assertDatabaseIsolation();
    }

    // 3. LIVE/MOCK Isolation Guard
    const decryptedToken = MetaApiService.getDecryptedToken(connection);
    const isMock = isMockToken(decryptedToken);
    if (isMock && process.env.NODE_ENV !== 'test') {
      await Logger.warn(
        'SYSTEM',
        'PreflightVerificationFailed',
        'Không thể thực hiện đồng bộ với Token Demo (MOCK).',
        ctx,
        { stage: 'preflight_verification', actor }
      );
      throw new Error(
        'Không thể thực hiện đồng bộ dữ liệu thật với Token Demo (MOCK). Vui lòng cập nhật User Access Token thật từ Meta.'
      );
    }

    // Event 3: Preflight verification result (Passed)
    await Logger.info(
      'SYSTEM',
      'PreflightVerificationResult',
      `Preflight verification thành công cho tài khoản ${normalizedAccountId}`,
      ctx,
      {
        stage: 'preflight_verification',
        actor,
        metadata: { isMock: false, isIsolated: true },
      }
    );

    // 4. Stale Job Recovery & Concurrency Protection (Bounded Lease Lock)
    const tLockStart = Date.now();
    await MetaSyncEngine.recoverStaleJobs(normalizedAccountId, ctx);

    const leaseCutoff = new Date(Date.now() - SYNC_JOB_LEASE_MS);
    const activeRunningJob = await prisma.syncJob.findFirst({
      where: {
        adAccountId: normalizedAccountId,
        status: 'running',
        startedAt: { gte: leaseCutoff },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (activeRunningJob && !options.force) {
      const elapsedSec = Math.round(
        (Date.now() - (activeRunningJob.startedAt?.getTime() || Date.now())) / 1000
      );
      const remainingSec = Math.max(0, Math.round(SYNC_JOB_LEASE_MS / 1000) - elapsedSec);
      await Logger.warn(
        'SYNC_ENGINE',
        'JobLockBlocked',
        `Tài khoản ${normalizedAccountId} đang bị khóa bởi Job ${activeRunningJob.id.slice(0, 8)}`,
        ctx,
        {
          stage: 'lock_acquisition',
          actor,
          metadata: { activeJobId: activeRunningJob.id, elapsedSec, remainingSec },
        }
      );
      throw new Error(
        `Một tiến trình đồng bộ khác cho tài khoản ${normalizedAccountId} đang chạy ` +
        `(Job ID: ${activeRunningJob.id.slice(0, 8)}, đã chạy ${elapsedSec}s). ` +
        `Vui lòng chờ khoảng ${remainingSec}s để tiến trình hoàn tất hoặc tự động giải phóng lock.`
      );
    }
    timings['lockAcquisitionMs'] = Date.now() - tLockStart;

    // Event 4: Job lock acquisition
    await Logger.info(
      'SYNC_ENGINE',
      'JobLockAcquired',
      `Đã chiếm lock đồng bộ an toàn cho tài khoản ${normalizedAccountId} (${timings['lockAcquisitionMs']}ms)`,
      ctx,
      {
        stage: 'lock_acquisition',
        durationMs: timings['lockAcquisitionMs'],
        actor,
      }
    );

    // 5. Initialize SyncJob Tracking Record
    const syncJob = await prisma.syncJob.create({
      data: {
        metaConnectionId: connection.id,
        adAccountId: normalizedAccountId,
        jobType,
        status: 'running',
        dateFrom: new Date(dateFrom + 'T00:00:00.000Z'),
        dateTo: new Date(dateTo + 'T23:59:59.999Z'),
        startedAt: new Date(),
        errorMessage: '[Giai đoạn 1/5] Khởi tạo kết nối Meta API và xác thực AdAccount...',
      },
    });

    ctx.syncJobId = syncJob.id;

    // Event 5: SyncJob started
    await Logger.info(
      'SYNC_ENGINE',
      'SyncJobStarted',
      `Bắt đầu SyncJob ${syncJob.id} cho tài khoản ${normalizedAccountId} (${dateFrom} -> ${dateTo})`,
      ctx,
      {
        stage: 'job_initialization',
        actor,
        metadata: { dateFrom, dateTo, jobType },
      }
    );

    console.log(
      `[MetaSyncEngine:Start] Job ${syncJob.id} started for account ${normalizedAccountId} (${dateFrom} -> ${dateTo})`
    );

    try {
      // 6. Fetch Ad Account Details & Upsert AdAccount in DB
      const tAccountStart = Date.now();
      const accountInfo = await MetaApiService.getAdAccount(normalizedAccountId, connection);

      const dbAdAccount = await prisma.adAccount.upsert({
        where: { accountId: normalizedAccountId },
        update: {
          accountName: accountInfo.accountName,
          currency: accountInfo.currency,
          timezoneName: accountInfo.timezoneName,
          status: accountInfo.status || 'ACTIVE',
          metaConnectionId: connection.id,
        },
        create: {
          metaConnectionId: connection.id,
          accountId: normalizedAccountId,
          accountName: accountInfo.accountName,
          currency: accountInfo.currency,
          timezoneName: accountInfo.timezoneName,
          status: accountInfo.status || 'ACTIVE',
        },
      });
      timings['adAccountSyncMs'] = Date.now() - tAccountStart;
      console.log(`[MetaSyncEngine:Stage] AdAccount ${accountInfo.accountName} upserted in ${timings['adAccountSyncMs']}ms`);

      // 7. Date Chunking: Sequential Daily Chunk Processing
      const requestedDates = splitDateRangeToDays(dateFrom, dateTo);
      const totalDates = requestedDates.length;
      const accountTimezone = accountInfo.timezoneName || dbAdAccount.timezoneName || 'Asia/Ho_Chi_Minh';

      const successfulDates: string[] = [];
      const failedDates: Array<{
        date: string;
        error: string;
        metaErrorCode?: number;
        metaErrorSubcode?: number;
        metaFbtraceId?: string;
      }> = [];
      const unprocessedDates: string[] = [];
      const chunkResults: DailyChunkResult[] = [];

      // Global entity tracking across all chunks
      const distinctCampaigns = new Map<string, { id: string; name: string }>();
      const distinctAdSets = new Map<string, { id: string; name: string; campaignId?: string }>();
      const distinctAds = new Map<string, { id: string; name: string; adsetId?: string; campaignId?: string }>();
      const campaignDbIdMap = new Map<string, string>();
      const adsetDbIdMap = new Map<string, string>();

      let grandTotalInsights = 0;
      let grandTotalSpend = 0;
      let grandTotalImpressions = 0;
      let grandTotalClicks = 0;

      for (let chunkIdx = 0; chunkIdx < requestedDates.length; chunkIdx++) {
        const currentDate = requestedDates[chunkIdx];
        const chunkStartTime = Date.now();
        const currentElapsedMs = chunkStartTime - startTime;

        // A. Execution Budget Safety Check (Stop safely when remaining budget < 25s)
        if (FUNCTION_TIMEOUT_MS - currentElapsedMs < SAFETY_BUDGET_REMAINING_MS) {
          const remaining = requestedDates.slice(chunkIdx);
          for (const unDate of remaining) {
            unprocessedDates.push(unDate);
            chunkResults.push({
              date: unDate,
              status: 'UNPROCESSED',
              insightsCount: 0,
              spend: 0,
              impressions: 0,
              clicks: 0,
              durationMs: 0,
              error: 'Ngừng an toàn: Quỹ thời gian Serverless còn lại không đủ để thực thi ngày này.',
            });
          }

          await Logger.warn(
            'SYNC_ENGINE',
            'ExecutionBudgetExceeded',
            `Dừng xử lý an toàn: Quỹ thời gian còn lại (${Math.round((FUNCTION_TIMEOUT_MS - currentElapsedMs) / 1000)}s) ` +
            `nhỏ hơn ngưỡng an toàn (${Math.round(SAFETY_BUDGET_REMAINING_MS / 1000)}s). Bỏ qua ${remaining.length} ngày chưa xử lý: ${remaining.join(', ')}`,
            ctx,
            {
              stage: 'budget_guard',
              actor,
              metadata: { elapsedMs: currentElapsedMs, remainingDates: remaining },
            }
          );
          break;
        }

        // B. Update live progress on SyncJob
        await prisma.syncJob.update({
          where: { id: syncJob.id },
          data: {
            errorMessage: `[Giai đoạn 3/5] Đang xử lý ngày ${currentDate} (${chunkIdx + 1}/${totalDates}). ` +
              `Đã xong: ${successfulDates.length} ngày, lỗi: ${failedDates.length} ngày...`,
          },
        });

        // C. Log DailyChunkStarted
        await Logger.info(
          'SYNC_ENGINE',
          'DailyChunkStarted',
          `Bắt đầu đồng bộ Daily Chunk ngày ${currentDate} (${chunkIdx + 1}/${totalDates}) cho tài khoản ${normalizedAccountId}`,
          ctx,
          {
            stage: 'daily_chunk_fetch',
            actor,
            metadata: {
              reportingDate: currentDate,
              chunkIndex: chunkIdx + 1,
              totalDates,
              timezone: accountTimezone,
            },
          }
        );

        try {
          // D. Fetch Daily Insights for currentDate with pagination and retry
          let chunkRetryCount = 0;
          const tInsightsFetchStart = Date.now();

          const insightsResult = await MetaApiService.getInsightsPaged(
            normalizedAccountId,
            connection,
            'ad',
            currentDate,
            currentDate,
            {
              limit: 100,
              maxPages: options.maxPages || 100,
              retryOptions: {
                onRetry: (attempt, err, delayMs) => {
                  chunkRetryCount++;
                  Logger.warn(
                    'META_API',
                    'MetaRequestRetry',
                    `[${currentDate}] Thử lại lần ${attempt} khi gọi Meta API sau ${delayMs}ms: ${(err as Error).message}`,
                    ctx,
                    {
                      stage: 'meta_api_retry',
                      retryAttempt: attempt,
                      durationMs: delayMs,
                      metadata: { reportingDate: currentDate },
                      metaError: err instanceof MetaApiError ? {
                        code: err.code,
                        subcode: err.subcode,
                        isTransient: err.isTransient,
                        fbtraceId: err.fbtraceId,
                        message: err.userMessage || err.message,
                      } : undefined,
                    }
                  );
                },
              },
            }
          );

          const rawInsights = insightsResult.data;
          const insightsFetchDuration = Date.now() - tInsightsFetchStart;
          timings[`insightsFetch_${currentDate}`] = insightsFetchDuration;

          const validInsights = rawInsights.filter(i => i.ad_id && i.date_start);

          // E. Distinguish empty day from failure
          if (validInsights.length === 0) {
            const chunkDuration = Date.now() - chunkStartTime;
            successfulDates.push(currentDate);
            chunkResults.push({
              date: currentDate,
              status: 'SUCCESS',
              insightsCount: 0,
              spend: 0,
              impressions: 0,
              clicks: 0,
              durationMs: chunkDuration,
            });

            await Logger.info(
              'SYNC_ENGINE',
              'DailyChunkCompleted',
              `Hoàn tất Daily Chunk ngày ${currentDate} (Không có dữ liệu quảng cáo phát sinh trong ngày, 0 insights, 0 VND, ${chunkDuration}ms)`,
              ctx,
              {
                stage: 'daily_chunk_persist',
                durationMs: chunkDuration,
                recordCount: 0,
                retryAttempt: chunkRetryCount,
                actor,
                metadata: {
                  reportingDate: currentDate,
                  pagesFetched: insightsResult.pagesFetched,
                  spend: 0,
                  isEmptyDay: true,
                  retries: chunkRetryCount,
                },
              }
            );
            continue;
          }

          // F. Extract Entities for this Chunk
          let chunkSpend = 0;
          let chunkImpressions = 0;
          let chunkClicks = 0;
          const chunkCampaigns = new Map<string, { id: string; name: string }>();
          const chunkAdSets = new Map<string, { id: string; name: string; campaignId?: string }>();
          const chunkAds = new Map<string, { id: string; name: string; adsetId?: string; campaignId?: string }>();

          for (const i of validInsights) {
            chunkSpend += parseFloat(i.spend || '0');
            chunkImpressions += parseInt(i.impressions || '0', 10);
            chunkClicks += parseInt(i.clicks || '0', 10);

            if (i.campaign_id) {
              const camp = { id: i.campaign_id, name: i.campaign_name || `Campaign ${i.campaign_id}` };
              chunkCampaigns.set(i.campaign_id, camp);
              distinctCampaigns.set(i.campaign_id, camp);
            }
            if (i.adset_id) {
              const as = { id: i.adset_id, name: i.adset_name || `AdSet ${i.adset_id}`, campaignId: i.campaign_id };
              chunkAdSets.set(i.adset_id, as);
              distinctAdSets.set(i.adset_id, as);
            }
            if (i.ad_id) {
              const ad = { id: i.ad_id, name: i.ad_name || `Ad ${i.ad_id}`, adsetId: i.adset_id, campaignId: i.campaign_id };
              chunkAds.set(i.ad_id, ad);
              distinctAds.set(i.ad_id, ad);
            }
          }

          grandTotalSpend += chunkSpend;
          grandTotalImpressions += chunkImpressions;
          grandTotalClicks += chunkClicks;
          grandTotalInsights += validInsights.length;

          // G. Upsert Campaigns for Chunk (Batched)
          const campaignList = Array.from(chunkCampaigns.values());
          await batchProcess(campaignList, 10, async (c) => {
            const dbCampaign = await prisma.campaign.upsert({
              where: { campaignId: c.id },
              update: { campaignName: c.name },
              create: {
                adAccountId: dbAdAccount.id,
                campaignId: c.id,
                campaignName: c.name,
                status: 'ACTIVE',
                effectiveStatus: 'ACTIVE',
              },
            });
            campaignDbIdMap.set(c.id, dbCampaign.id);
          });

          // H. Upsert AdSets for Chunk (Batched)
          const adsetList = Array.from(chunkAdSets.values());
          await batchProcess(adsetList, 15, async (as) => {
            let parentCampaignDbId = as.campaignId ? campaignDbIdMap.get(as.campaignId) : undefined;
            if (!parentCampaignDbId && as.campaignId) {
              const placeholder = await prisma.campaign.create({
                data: {
                  adAccountId: dbAdAccount.id,
                  campaignId: as.campaignId,
                  campaignName: `Campaign ${as.campaignId}`,
                  status: 'UNKNOWN',
                  effectiveStatus: 'UNKNOWN',
                },
              });
              parentCampaignDbId = placeholder.id;
              campaignDbIdMap.set(as.campaignId, placeholder.id);
            }
            if (parentCampaignDbId) {
              const dbAdSet = await prisma.adSet.upsert({
                where: { adsetId: as.id },
                update: { adsetName: as.name },
                create: {
                  adAccountId: dbAdAccount.id,
                  campaignId: parentCampaignDbId,
                  adsetId: as.id,
                  adsetName: as.name,
                  status: 'ACTIVE',
                  effectiveStatus: 'ACTIVE',
                },
              });
              adsetDbIdMap.set(as.id, dbAdSet.id);
            }
          });

          // I. Upsert Ads for Chunk (Batched)
          const adList = Array.from(chunkAds.values());
          await batchProcess(adList, 20, async (ad) => {
            const parentCampaignDbId = ad.campaignId ? campaignDbIdMap.get(ad.campaignId) : undefined;
            const parentAdSetDbId = ad.adsetId ? adsetDbIdMap.get(ad.adsetId) : undefined;
            if (parentCampaignDbId && parentAdSetDbId) {
              await prisma.ad.upsert({
                where: { adId: ad.id },
                update: { adName: ad.name },
                create: {
                  adAccountId: dbAdAccount.id,
                  campaignId: parentCampaignDbId,
                  adsetId: parentAdSetDbId,
                  adId: ad.id,
                  adName: ad.name,
                  status: 'ACTIVE',
                  effectiveStatus: 'ACTIVE',
                },
              });
            }
          });

          // J. Upsert InsightsDaily for Chunk (Batched)
          await batchProcess(validInsights, 20, async (insight) => {
            const dateObj = new Date(insight.date_start + 'T00:00:00.000Z');
            const spendVal = parseFloat(insight.spend || '0');
            const impVal = parseInt(insight.impressions || '0', 10);
            const clicksVal = parseInt(insight.clicks || '0', 10);
            const reachVal = parseInt(insight.reach || '0', 10);
            const linkClicksVal = parseInt(insight.inline_link_clicks || '0', 10);

            let leadsVal = 0;
            if (Array.isArray(insight.actions)) {
              const leadAction = insight.actions.find(
                a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
              );
              if (leadAction) {
                leadsVal = parseInt(leadAction.value || '0', 10);
              }
            }

            let video3sViewsVal = 0;
            if (Array.isArray(insight.actions)) {
              const videoViewAction = insight.actions.find(a => a.action_type === 'video_view');
              if (videoViewAction) {
                video3sViewsVal = parseInt(videoViewAction.value || '0', 10);
              }
            }

            const actionsJson = insight.actions ? JSON.stringify(insight.actions) : null;
            const costPerActionTypeJson = insight.cost_per_action_type ? JSON.stringify(insight.cost_per_action_type) : null;
            const breakdownJson = insight.action_values ? JSON.stringify(insight.action_values) : null;

            await prisma.insightsDaily.upsert({
              where: {
                date_level_adId: {
                  date: dateObj,
                  level: 'ad',
                  adId: insight.ad_id!,
                },
              },
              update: {
                campaignId: insight.campaign_id || '',
                campaignName: insight.campaign_name || '',
                adsetId: insight.adset_id || '',
                adsetName: insight.adset_name || '',
                adName: insight.ad_name || '',
                spend: spendVal,
                impressions: impVal,
                reach: reachVal,
                frequency: reachVal > 0 ? impVal / reachVal : 1.0,
                clicks: clicksVal,
                linkClicks: linkClicksVal,
                ctr: impVal > 0 ? (clicksVal / impVal) * 100 : 0,
                cpc: clicksVal > 0 ? spendVal / clicksVal : 0,
                cpm: impVal > 0 ? (spendVal / impVal) * 1000 : 0,
                leads: leadsVal,
                costPerLead: leadsVal > 0 ? spendVal / leadsVal : 0,
                video3sViews: video3sViewsVal,
                actionsJson,
                costPerActionTypeJson,
                breakdownJson,
              },
              create: {
                date: dateObj,
                adAccountId: dbAdAccount.id,
                campaignId: insight.campaign_id || '',
                campaignName: insight.campaign_name || '',
                adsetId: insight.adset_id || '',
                adsetName: insight.adset_name || '',
                adId: insight.ad_id!,
                adName: insight.ad_name || '',
                level: 'ad',
                spend: spendVal,
                impressions: impVal,
                reach: reachVal,
                frequency: reachVal > 0 ? impVal / reachVal : 1.0,
                clicks: clicksVal,
                linkClicks: linkClicksVal,
                ctr: impVal > 0 ? (clicksVal / impVal) * 100 : 0,
                cpc: clicksVal > 0 ? spendVal / clicksVal : 0,
                cpm: impVal > 0 ? (spendVal / impVal) * 1000 : 0,
                leads: leadsVal,
                costPerLead: leadsVal > 0 ? spendVal / leadsVal : 0,
                video3sViews: video3sViewsVal,
                actionsJson,
                costPerActionTypeJson,
                breakdownJson,
              },
            });
          });

          const chunkDuration = Date.now() - chunkStartTime;
          successfulDates.push(currentDate);
          chunkResults.push({
            date: currentDate,
            status: 'SUCCESS',
            insightsCount: validInsights.length,
            spend: Math.round(chunkSpend),
            impressions: chunkImpressions,
            clicks: chunkClicks,
            durationMs: chunkDuration,
          });

          // K. Log DailyChunkCompleted
          await Logger.info(
            'SYNC_ENGINE',
            'DailyChunkCompleted',
            `Hoàn tất Daily Chunk ngày ${currentDate}: ${validInsights.length} insights, chi tiêu: ${Math.round(chunkSpend).toLocaleString()} VND (${chunkDuration}ms)`,
            ctx,
            {
              stage: 'daily_chunk_persist',
              durationMs: chunkDuration,
              recordCount: validInsights.length,
              retryAttempt: chunkRetryCount,
              actor,
              metadata: {
                reportingDate: currentDate,
                spend: Math.round(chunkSpend),
                impressions: chunkImpressions,
                clicks: chunkClicks,
                campaignsInChunk: chunkCampaigns.size,
                adsInChunk: chunkAds.size,
                retries: chunkRetryCount,
              },
            }
          );
        } catch (chunkErr: unknown) {
          const chunkDuration = Date.now() - chunkStartTime;
          const chunkErrMsg = chunkErr instanceof Error ? chunkErr.message : 'Unknown chunk error';
          const isMetaErr = chunkErr instanceof MetaApiError;
          const metaCode = isMetaErr ? chunkErr.code : undefined;
          const metaSubcode = isMetaErr ? chunkErr.subcode : undefined;
          const fbtraceId = isMetaErr ? chunkErr.fbtraceId : undefined;

          failedDates.push({
            date: currentDate,
            error: chunkErrMsg,
            metaErrorCode: typeof metaCode === 'number' ? metaCode : undefined,
            metaErrorSubcode: typeof metaSubcode === 'number' ? metaSubcode : undefined,
            metaFbtraceId: fbtraceId,
          });

          chunkResults.push({
            date: currentDate,
            status: 'FAILED',
            insightsCount: 0,
            spend: 0,
            impressions: 0,
            clicks: 0,
            durationMs: chunkDuration,
            error: chunkErrMsg,
            metaErrorCode: typeof metaCode === 'number' ? metaCode : undefined,
            metaErrorSubcode: typeof metaSubcode === 'number' ? metaSubcode : undefined,
            metaFbtraceId: fbtraceId,
          });

          // Log DailyChunkFailed
          await Logger.error(
            'SYNC_ENGINE',
            'DailyChunkFailed',
            `Thất bại khi đồng bộ Daily Chunk ngày ${currentDate}: ${chunkErrMsg}`,
            ctx,
            {
              stage: 'daily_chunk_failure',
              durationMs: chunkDuration,
              actor,
              metadata: { reportingDate: currentDate },
              metaError: isMetaErr ? {
                code: chunkErr.code,
                subcode: chunkErr.subcode,
                isTransient: chunkErr.isTransient,
                fbtraceId: chunkErr.fbtraceId,
                message: chunkErr.userMessage || chunkErr.message,
                raw: chunkErr.raw,
              } : undefined,
            }
          );

          // Permanent error check: Expired token or auth failure terminates remaining dates
          const isPermanent = isMetaErr && (chunkErr.category === 'TOKEN_EXPIRED' || chunkErr.code === 190);
          if (isPermanent) {
            const remaining = requestedDates.slice(chunkIdx + 1);
            for (const unDate of remaining) {
              unprocessedDates.push(unDate);
              chunkResults.push({
                date: unDate,
                status: 'UNPROCESSED',
                insightsCount: 0,
                spend: 0,
                impressions: 0,
                clicks: 0,
                durationMs: 0,
                error: 'Không xử lý do phát hiện lỗi vĩnh viễn (Token hết hạn/Auth error) ở ngày trước.',
              });
            }
            await Logger.warn(
              'SYNC_ENGINE',
              'SubsequentChunksAborted',
              `Ngừng toàn bộ các ngày tiếp theo do lỗi tài khoản vĩnh viễn (Token Expired) ở ngày ${currentDate}`,
              ctx,
              { stage: 'token_expiration_abort', actor }
            );
            break;
          }
          // For non-permanent errors, continue to the next date!
        }
      }

      // 8. Expired Worker Protection: Ensure our job lease was not revoked
      const currentJobState = await prisma.syncJob.findUnique({
        where: { id: syncJob.id },
        select: { status: true },
      });

      if (currentJobState && currentJobState.status !== 'running') {
        throw new Error(
          `Tiến trình (Job ID: ${syncJob.id}) đã hết hạn lease hoặc bị thu hồi lock (Trạng thái hiện tại: ${currentJobState.status}). Hủy thao tác ghi nhận hoàn tất.`
        );
      }

      // 9. Determine Final Job Status (SUCCESS, PARTIAL, FAILED)
      let finalStatus: 'success' | 'partial' | 'failed' = 'failed';
      if (failedDates.length === 0 && unprocessedDates.length === 0) {
        finalStatus = 'success';
      } else if (successfulDates.length > 0) {
        finalStatus = 'partial';
      } else {
        finalStatus = 'failed';
      }

      const totalExecutionTimeMs = Date.now() - startTime;
      timings['totalExecutionTimeMs'] = totalExecutionTimeMs;

      const summaryMessage = finalStatus === 'success'
        ? null
        : `Đồng bộ hoàn tất ${finalStatus.toUpperCase()}: ${successfulDates.length}/${totalDates} ngày thành công, ${failedDates.length} ngày lỗi, ${unprocessedDates.length} ngày chưa xử lý.${failedDates.length > 0 ? ` Lỗi tiêu biểu: ${failedDates[0].error}` : ''}`;

      // Finalize SyncJob in Neon
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
          errorMessage: summaryMessage,
        },
      });

      // Update connection's lastSyncAt if any date succeeded
      if (finalStatus !== 'failed') {
        await prisma.metaConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: new Date(),
            status: 'connected',
          },
        });
      }

      // Event 17: SyncJob completed / partial / failed
      await Logger.info(
        'SYNC_ENGINE',
        finalStatus === 'success' ? 'SyncJobCompleted' : finalStatus === 'partial' ? 'SyncJobPartial' : 'SyncJobFailed',
        `SyncJob ${syncJob.id} kết thúc với trạng thái ${finalStatus.toUpperCase()} trong ${totalExecutionTimeMs}ms (${successfulDates.length}/${totalDates} ngày)`,
        ctx,
        {
          stage: 'job_completion',
          durationMs: totalExecutionTimeMs,
          recordCount: grandTotalInsights,
          actor,
          metadata: {
            finalStatus,
            totalDates,
            successfulDates,
            failedDates,
            unprocessedDates,
            campaignsUpserted: distinctCampaigns.size,
            adsetsUpserted: distinctAdSets.size,
            adsUpserted: distinctAds.size,
            insightsUpserted: grandTotalInsights,
            totalSpend: Math.round(grandTotalSpend),
            totalImpressions: grandTotalImpressions,
            totalClicks: grandTotalClicks,
          },
        }
      );

      console.log(
        `[MetaSyncEngine:Complete] Job ${syncJob.id} finished as ${finalStatus.toUpperCase()} in ${totalExecutionTimeMs}ms. ` +
        `Dates: ${successfulDates.length} success, ${failedDates.length} failed, ${unprocessedDates.length} unprocessed. ` +
        `Persisted ${distinctCampaigns.size} campaigns, ${distinctAdSets.size} adsets, ${distinctAds.size} ads, ${grandTotalInsights} insights. ` +
        `Total Spend: ${Math.round(grandTotalSpend)} VND, Imp: ${grandTotalImpressions}, Clicks: ${grandTotalClicks}`
      );

      return {
        success: finalStatus !== 'failed',
        status: finalStatus.toUpperCase() as 'SUCCESS' | 'PARTIAL' | 'FAILED',
        jobId: syncJob.id,
        jobType,
        adAccountId: normalizedAccountId,
        accountName: accountInfo.accountName,
        dateRange: { since: dateFrom, until: dateTo },
        datesSummary: {
          totalDates,
          successfulCount: successfulDates.length,
          failedCount: failedDates.length,
          unprocessedCount: unprocessedDates.length,
          successfulDates,
          failedDates,
          unprocessedDates,
        },
        chunks: chunkResults,
        counts: {
          campaignsUpserted: distinctCampaigns.size,
          adsetsUpserted: distinctAdSets.size,
          adsUpserted: distinctAds.size,
          insightsUpserted: grandTotalInsights,
        },
        metrics: {
          totalSpend: Math.round(grandTotalSpend),
          totalImpressions: grandTotalImpressions,
          totalClicks: grandTotalClicks,
        },
        timings,
        executionTimeMs: totalExecutionTimeMs,
        error: finalStatus === 'failed' ? (failedDates[0]?.error || 'Tất cả các ngày yêu cầu đều thất bại.') : undefined,
      };
    } catch (error: unknown) {
      const errorMsg = (error as Error).message || 'Unknown sync error';
      console.error(`Meta Sync failed for ${normalizedAccountId}:`, error);

      // Event 8: Meta API request failed (if error is MetaApiError)
      if (error instanceof MetaApiError) {
        await Logger.error(
          'META_API',
          'MetaRequestFailed',
          `Truy vấn Meta API thất bại: ${error.userMessage || error.message}`,
          ctx,
          {
            stage: 'meta_api_call',
            actor,
            metaError: {
              code: error.code,
              subcode: error.subcode,
              isTransient: error.isTransient,
              fbtraceId: error.fbtraceId,
              message: error.userMessage || error.message,
              raw: error.raw,
            },
          }
        );
      }

      // Event 18: SyncJob failed
      await Logger.error(
        'SYNC_ENGINE',
        'SyncJobFailed',
        `SyncJob ${syncJob?.id || 'unassigned'} thất bại: ${errorMsg}`,
        ctx,
        {
          stage: 'job_failure',
          durationMs: Date.now() - startTime,
          actor,
          metaError: error instanceof MetaApiError ? {
            code: error.code,
            subcode: error.subcode,
            isTransient: error.isTransient,
            fbtraceId: error.fbtraceId,
            message: error.userMessage || error.message,
            raw: error.raw,
          } : undefined,
        }
      );

      // Record failure in SyncJob without wiping existing data
      try {
        await prisma.syncJob.update({
          where: { id: syncJob.id },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: errorMsg,
          },
        });
      } catch {
        // Ignored if update fails
      }

      // Check if token expired
      if (error instanceof MetaApiError && error.category === 'TOKEN_EXPIRED') {
        try {
          await prisma.metaConnection.update({
            where: { id: connection.id },
            data: { status: 'error' },
          });
        } catch {
          // Ignored
        }
      }

      throw error;
    }
  }
}
