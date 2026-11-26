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

export interface SyncResult {
  success: boolean;
  jobId: string;
  jobType: string;
  adAccountId: string;
  accountName: string;
  dateRange: { since: string; until: string };
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

      // Update progress
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 2/5] Đang tải Daily Insights từ Meta API (${dateFrom} đến ${dateTo})...`,
        },
      });

      // Event 6: Meta API request started
      await Logger.info(
        'META_API',
        'MetaRequestStarted',
        `Bắt đầu truy vấn Daily Insights cho tài khoản ${normalizedAccountId} qua Meta Marketing API`,
        ctx,
        {
          stage: 'meta_insights_request',
          actor,
          metadata: { level: 'ad', dateFrom, dateTo, maxPages: options.maxPages || 100 },
        }
      );

      // 7. Insights-First: Retrieve Daily Ad-Level Insights for requested date range
      const tInsightsFetchStart = Date.now();
      let retryCount = 0;

      const insightsResult = await MetaApiService.getInsightsPaged(
        normalizedAccountId,
        connection,
        'ad',
        dateFrom,
        dateTo,
        {
          limit: 100,
          maxPages: options.maxPages || 100,
          retryOptions: {
            onRetry: (attempt, err, delayMs) => {
              retryCount++;
              // Event 10: Existing retry attempts
              Logger.warn(
                'META_API',
                'MetaRequestRetry',
                `Thử lại lần ${attempt} khi gọi Meta API sau ${delayMs}ms`,
                ctx,
                {
                  stage: 'meta_api_retry',
                  retryAttempt: attempt,
                  durationMs: delayMs,
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
      timings['insightsFetchMs'] = Date.now() - tInsightsFetchStart;

      // Event 7: Meta API request completed
      await Logger.info(
        'META_API',
        'MetaRequestCompleted',
        `Truy vấn Meta API hoàn tất trong ${timings['insightsFetchMs']}ms (${rawInsights.length} bản ghi, ${insightsResult.pagesFetched} trang)`,
        ctx,
        {
          stage: 'meta_insights_request',
          durationMs: timings['insightsFetchMs'],
          recordCount: rawInsights.length,
          retryAttempt: retryCount,
          actor,
        }
      );

      // Event 9: Pagination progress and completion
      await Logger.info(
        'META_API',
        'PaginationCompleted',
        `Hoàn thành phân trang Meta API: ${insightsResult.pagesFetched} trang, ${rawInsights.length} bản ghi`,
        ctx,
        {
          stage: 'pagination',
          recordCount: rawInsights.length,
          metadata: {
            pagesFetched: insightsResult.pagesFetched,
            hasMore: insightsResult.hasMore,
          },
        }
      );

      console.log(
        `[MetaSyncEngine:Timing] Retrieved ${rawInsights.length} raw insight records across ` +
        `${insightsResult.pagesFetched} page(s) in ${timings['insightsFetchMs']}ms`
      );

      // Filter valid insights with ad_id and date_start
      const validInsights = rawInsights.filter(i => i.ad_id && i.date_start);

      // Event 11: Insights retrieved
      await Logger.info(
        'SYNC_ENGINE',
        'InsightsRetrieved',
        `Đã tiếp nhận ${validInsights.length} bản ghi Daily Insights hợp lệ`,
        ctx,
        {
          stage: 'insights_retrieval',
          recordCount: validInsights.length,
          metadata: { totalRaw: rawInsights.length, totalValid: validInsights.length },
        }
      );

      // 8. Extract Distinct Active Entities from Insights Data
      const tExtractStart = Date.now();
      const distinctCampaigns = new Map<string, { id: string; name: string }>();
      const distinctAdSets = new Map<string, { id: string; name: string; campaignId?: string }>();
      const distinctAds = new Map<string, { id: string; name: string; adsetId?: string; campaignId?: string }>();

      let totalSpend = 0;
      let totalImpressions = 0;
      let totalClicks = 0;

      for (const i of validInsights) {
        totalSpend += parseFloat(i.spend || '0');
        totalImpressions += parseInt(i.impressions || '0', 10);
        totalClicks += parseInt(i.clicks || '0', 10);

        if (i.campaign_id) {
          distinctCampaigns.set(i.campaign_id, {
            id: i.campaign_id,
            name: i.campaign_name || `Campaign ${i.campaign_id}`,
          });
        }
        if (i.adset_id) {
          distinctAdSets.set(i.adset_id, {
            id: i.adset_id,
            name: i.adset_name || `AdSet ${i.adset_id}`,
            campaignId: i.campaign_id,
          });
        }
        if (i.ad_id) {
          distinctAds.set(i.ad_id, {
            id: i.ad_id,
            name: i.ad_name || `Ad ${i.ad_id}`,
            adsetId: i.adset_id,
            campaignId: i.campaign_id,
          });
        }
      }
      timings['extractionMs'] = Date.now() - tExtractStart;

      // Event 12: Entity extraction completed
      await Logger.info(
        'SYNC_ENGINE',
        'EntityExtractionCompleted',
        `Hoàn tất bóc tách cấu trúc trong ${timings['extractionMs']}ms: ${distinctCampaigns.size} Campaigns, ${distinctAdSets.size} AdSets, ${distinctAds.size} Ads`,
        ctx,
        {
          stage: 'entity_extraction',
          durationMs: timings['extractionMs'],
          recordCount: distinctCampaigns.size + distinctAdSets.size + distinctAds.size,
          metadata: {
            campaignsCount: distinctCampaigns.size,
            adsetsCount: distinctAdSets.size,
            adsCount: distinctAds.size,
          },
        }
      );

      console.log(
        `[MetaSyncEngine:Extraction] Found ${distinctCampaigns.size} campaigns, ` +
        `${distinctAdSets.size} adsets, ${distinctAds.size} ads from ${validInsights.length} insights.`
      );

      // Update progress
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 3/5] Đang ghi nạp cấu trúc ${distinctCampaigns.size} Chiến dịch, ${distinctAdSets.size} Nhóm QC, ${distinctAds.size} Mẫu QC...`,
        },
      });

      // 9. Foreign-Key Ordered Entity Persistence (Batched)
      const tEntityPersistStart = Date.now();

      // 9a. Campaigns Upsert
      const tCampStart = Date.now();
      const campaignDbIdMap = new Map<string, string>();
      const campaignList = Array.from(distinctCampaigns.values());
      await batchProcess(campaignList, 10, async (c) => {
        const dbCampaign = await prisma.campaign.upsert({
          where: { campaignId: c.id },
          update: {
            campaignName: c.name,
          },
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
      timings['campaignPersistenceMs'] = Date.now() - tCampStart;

      // Event 13: Campaign persistence completed
      await Logger.info(
        'DATABASE',
        'CampaignPersistenceCompleted',
        `Đã lưu ${campaignList.length} Campaign vào Neon (${timings['campaignPersistenceMs']}ms)`,
        ctx,
        {
          stage: 'campaign_persistence',
          durationMs: timings['campaignPersistenceMs'],
          recordCount: campaignList.length,
        }
      );

      // 9b. AdSets Upsert
      const tAdSetStart = Date.now();
      const adsetDbIdMap = new Map<string, string>();
      const adsetList = Array.from(distinctAdSets.values());
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
            update: {
              adsetName: as.name,
            },
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
      timings['adsetPersistenceMs'] = Date.now() - tAdSetStart;

      // Event 14: Ad Set persistence completed
      await Logger.info(
        'DATABASE',
        'AdSetPersistenceCompleted',
        `Đã lưu ${adsetList.length} AdSet vào Neon (${timings['adsetPersistenceMs']}ms)`,
        ctx,
        {
          stage: 'adset_persistence',
          durationMs: timings['adsetPersistenceMs'],
          recordCount: adsetList.length,
        }
      );

      // 9c. Ads Upsert
      const tAdStart = Date.now();
      const adList = Array.from(distinctAds.values());
      await batchProcess(adList, 20, async (ad) => {
        const parentCampaignDbId = ad.campaignId ? campaignDbIdMap.get(ad.campaignId) : undefined;
        const parentAdSetDbId = ad.adsetId ? adsetDbIdMap.get(ad.adsetId) : undefined;

        if (parentCampaignDbId && parentAdSetDbId) {
          await prisma.ad.upsert({
            where: { adId: ad.id },
            update: {
              adName: ad.name,
            },
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
      timings['adPersistenceMs'] = Date.now() - tAdStart;

      // Event 15: Ad persistence completed
      await Logger.info(
        'DATABASE',
        'AdPersistenceCompleted',
        `Đã lưu ${adList.length} Ad vào Neon (${timings['adPersistenceMs']}ms)`,
        ctx,
        {
          stage: 'ad_persistence',
          durationMs: timings['adPersistenceMs'],
          recordCount: adList.length,
        }
      );

      timings['entitiesPersistenceMs'] = Date.now() - tEntityPersistStart;
      console.log(`[MetaSyncEngine:Timing] Persisted active entities in ${timings['entitiesPersistenceMs']}ms`);

      // Update progress
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 4/5] Đang ghi ${validInsights.length} bản ghi Daily Insights vào Neon...`,
        },
      });

      // 10. Batch Upsert InsightsDaily (Parallel Batches of 20)
      const tInsightsPersistStart = Date.now();
      await batchProcess(validInsights, 20, async (insight) => {
        const dateObj = new Date(insight.date_start + 'T00:00:00.000Z');
        const spendVal = parseFloat(insight.spend || '0');
        const impVal = parseInt(insight.impressions || '0', 10);
        const clicksVal = parseInt(insight.clicks || '0', 10);
        const reachVal = parseInt(insight.reach || '0', 10);
        const linkClicksVal = parseInt(insight.inline_link_clicks || '0', 10);

        // Calculate Meta Leads from actions array
        let leadsVal = 0;
        if (Array.isArray(insight.actions)) {
          const leadAction = insight.actions.find(
            a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
          );
          if (leadAction) {
            leadsVal = parseInt(leadAction.value || '0', 10);
          }
        }

        // Extract 3-second video views from actions (action_type === "video_view").
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
      timings['insightsPersistenceMs'] = Date.now() - tInsightsPersistStart;

      // Event 16: Daily Insights persistence completed
      await Logger.info(
        'DATABASE',
        'DailyInsightsPersistenceCompleted',
        `Đã lưu ${validInsights.length} bản ghi Daily Insights vào Neon (${timings['insightsPersistenceMs']}ms)`,
        ctx,
        {
          stage: 'insights_persistence',
          durationMs: timings['insightsPersistenceMs'],
          recordCount: validInsights.length,
        }
      );

      console.log(`[MetaSyncEngine:Timing] Persisted ${validInsights.length} insights in ${timings['insightsPersistenceMs']}ms`);

      // 11. Expired Worker Protection: Ensure our job lease was not revoked
      const currentJobState = await prisma.syncJob.findUnique({
        where: { id: syncJob.id },
        select: { status: true },
      });

      if (currentJobState && currentJobState.status !== 'running') {
        throw new Error(
          `Tiến trình (Job ID: ${syncJob.id}) đã hết hạn lease hoặc bị thu hồi lock (Trạng thái hiện tại: ${currentJobState.status}). Hủy thao tác ghi nhận hoàn tất.`
        );
      }

      // Finalize SyncJob on Success
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          errorMessage: null,
        },
      });

      // Update connection's lastSyncAt
      await prisma.metaConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          status: 'connected',
        },
      });

      const totalExecutionTimeMs = Date.now() - startTime;
      timings['totalExecutionTimeMs'] = totalExecutionTimeMs;

      // Event 17: SyncJob completed
      await Logger.info(
        'SYNC_ENGINE',
        'SyncJobCompleted',
        `SyncJob ${syncJob.id} hoàn tất thành công trong ${totalExecutionTimeMs}ms`,
        ctx,
        {
          stage: 'job_completion',
          durationMs: totalExecutionTimeMs,
          recordCount: validInsights.length,
          actor,
          metadata: {
            campaignsUpserted: campaignList.length,
            adsetsUpserted: adsetList.length,
            adsUpserted: adList.length,
            insightsUpserted: validInsights.length,
            totalSpend: Math.round(totalSpend),
            totalImpressions,
            totalClicks,
          },
        }
      );

      console.log(
        `[MetaSyncEngine:Complete] Job ${syncJob.id} completed successfully in ${totalExecutionTimeMs}ms. ` +
        `Persisted ${campaignList.length} campaigns, ${adsetList.length} adsets, ${adList.length} ads, ${validInsights.length} insights. ` +
        `Total Spend: ${Math.round(totalSpend)} VND, Imp: ${totalImpressions}, Clicks: ${totalClicks}`
      );

      return {
        success: true,
        jobId: syncJob.id,
        jobType,
        adAccountId: normalizedAccountId,
        accountName: accountInfo.accountName,
        dateRange: { since: dateFrom, until: dateTo },
        counts: {
          campaignsUpserted: campaignList.length,
          adsetsUpserted: adsetList.length,
          adsUpserted: adList.length,
          insightsUpserted: validInsights.length,
        },
        metrics: {
          totalSpend: Math.round(totalSpend),
          totalImpressions,
          totalClicks,
        },
        timings,
        executionTimeMs: totalExecutionTimeMs,
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
