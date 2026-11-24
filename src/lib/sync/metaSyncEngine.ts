import { prisma } from '@/lib/db';
import {
  MetaApiService,
  MetaApiError,
  MetaConnectionParam,
  normalizeAdAccountId,
  isMockToken,
} from '@/lib/meta';
import { assertDatabaseIsolation } from './preflightGuard';

export interface SyncOptions {
  adAccountId: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  jobType?: 'manual_sync' | 'scheduled_cron';
  maxPages?: number;
  force?: boolean;
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
  executionTimeMs: number;
  error?: string;
}

export interface StaleJobRecoveryResult {
  recoveredCount: number;
  recoveredJobIds: string[];
}

// Allowed accounts during initial testing (Strict scope control)
export const ENABLED_ACCOUNTS_FOR_SYNC = ['act_1380498158917028', '1380498158917028'];

// Bounded lease for Serverless Execution (90 seconds).
// Since Vercel Serverless Function maxDuration is 60s, any job still 'running'
// after 90 seconds is guaranteed to have timed out or terminated.
export const SYNC_JOB_LEASE_MS = 90 * 1000;

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
  public static async recoverStaleJobs(adAccountId?: string): Promise<StaleJobRecoveryResult> {
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
   * Synchronizes advertising structure and daily ad-level insights
   * from Meta Marketing API into Neon PostgreSQL.
   */
  public static async syncAdAccount(
    connection: MetaConnectionParam & { id: string },
    options: SyncOptions
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const normalizedAccountId = normalizeAdAccountId(options.adAccountId);
    const jobType = options.jobType || 'manual_sync';

    // 1. Strict Scope Enforcement
    const isAllowed = ENABLED_ACCOUNTS_FOR_SYNC.includes(normalizedAccountId);
    if (!isAllowed) {
      throw new Error(
        `Tài khoản ${normalizedAccountId} chưa được bật tính năng đồng bộ tự động. ` +
        `Trong giai đoạn nghiệm thu Stage 1A/Task 2, chỉ tài khoản GIS Hà Nội (act_1380498158917028) được phép đồng bộ.`
      );
    }

    // 2. Database Isolation Guard (Safety First: Never write to Production during Preview testing)
    // Only bypass in local unit tests with file:./dev.db
    if (process.env.NODE_ENV !== 'test') {
      assertDatabaseIsolation();
    }

    // 3. LIVE/MOCK Isolation Guard
    const decryptedToken = MetaApiService.getDecryptedToken(connection);
    const isMock = isMockToken(decryptedToken);
    if (isMock && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'Không thể thực hiện đồng bộ dữ liệu thật với Token Demo (MOCK). Vui lòng cập nhật User Access Token thật từ Meta.'
      );
    }

    // 4. Stale Job Recovery & Concurrency Protection (Bounded Lease Lock)
    // 4a. First, automatically detect and recover any stale jobs for this account
    await MetaSyncEngine.recoverStaleJobs(normalizedAccountId);

    // 4b. Check for genuinely active running jobs within the lease duration
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
      throw new Error(
        `Một tiến trình đồng bộ khác cho tài khoản ${normalizedAccountId} đang chạy ` +
        `(Job ID: ${activeRunningJob.id.slice(0, 8)}, đã chạy ${elapsedSec}s). ` +
        `Vui lòng chờ khoảng ${remainingSec}s để tiến trình hoàn tất hoặc tự động giải phóng lock.`
      );
    }

    // Resolve date window (Defaults to last 30 days if unspecified)
    const now = new Date();
    const defaultDateTo = now.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultDateFrom = thirtyDaysAgo.toISOString().split('T')[0];

    const dateFrom = normalizeSyncDate(options.dateFrom, defaultDateFrom);
    const dateTo = normalizeSyncDate(options.dateTo, defaultDateTo);

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
        errorMessage: '[Giai đoạn 1/4] Đang khởi tạo và kết nối Meta API...',
      },
    });

    try {
      // 6. Fetch Ad Account Details & Upsert AdAccount in DB
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

      // Update progress stage
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 2/4] Đã nạp AdAccount ${accountInfo.accountName}. Đang lấy Chiến dịch...`,
        },
      });

      // 7. Complete Campaign Pagination & Idempotent Upsert (Batched)
      const campaignsResult = await MetaApiService.getCampaignsPaged(
        normalizedAccountId,
        connection,
        { limit: 50, maxPages: options.maxPages || 50 }
      );
      const campaigns = campaignsResult.data;

      const campaignMap = new Map<string, string>();
      await batchProcess(campaigns, 10, async (c) => {
        const dbCampaign = await prisma.campaign.upsert({
          where: { campaignId: c.id },
          update: {
            campaignName: c.name || `Campaign ${c.id}`,
            objective: c.objective || null,
            status: c.status || 'UNKNOWN',
            effectiveStatus: c.effective_status || c.status || 'UNKNOWN',
            buyingType: c.buying_type || null,
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) : null,
            lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) : null,
            startTime: c.start_time ? new Date(c.start_time) : null,
            endTime: c.stop_time ? new Date(c.stop_time) : null,
            rawJson: JSON.stringify(c),
          },
          create: {
            adAccountId: dbAdAccount.id,
            campaignId: c.id,
            campaignName: c.name || `Campaign ${c.id}`,
            objective: c.objective || null,
            status: c.status || 'UNKNOWN',
            effectiveStatus: c.effective_status || c.status || 'UNKNOWN',
            buyingType: c.buying_type || null,
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) : null,
            lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) : null,
            startTime: c.start_time ? new Date(c.start_time) : null,
            endTime: c.stop_time ? new Date(c.stop_time) : null,
            rawJson: JSON.stringify(c),
          },
        });
        campaignMap.set(c.id, dbCampaign.id);
      });

      // Update progress stage
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 3/4] Đã nạp ${campaigns.length} Chiến dịch. Đang lấy Nhóm QC & Mẫu QC...`,
        },
      });

      // 8. Complete AdSet Pagination & Idempotent Upsert (Batched)
      const adsetsResult = await MetaApiService.getAdSetsPaged(
        normalizedAccountId,
        connection,
        { limit: 50, maxPages: options.maxPages || 50 }
      );
      const adsets = adsetsResult.data;

      // Ensure missing placeholder campaigns exist
      for (const as of adsets) {
        if (as.campaign_id && !campaignMap.has(as.campaign_id)) {
          const placeholder = await prisma.campaign.create({
            data: {
              adAccountId: dbAdAccount.id,
              campaignId: as.campaign_id,
              campaignName: `Campaign ${as.campaign_id}`,
              status: 'UNKNOWN',
              effectiveStatus: 'UNKNOWN',
            },
          });
          campaignMap.set(as.campaign_id, placeholder.id);
        }
      }

      await batchProcess(adsets, 15, async (as) => {
        const parentCampaignDbId = as.campaign_id ? campaignMap.get(as.campaign_id) : undefined;
        if (parentCampaignDbId) {
          await prisma.adSet.upsert({
            where: { adsetId: as.id },
            update: {
              adsetName: as.name || `AdSet ${as.id}`,
              optimizationGoal: as.optimization_goal || null,
              billingEvent: as.billing_event || null,
              bidStrategy: as.bid_strategy || null,
              dailyBudget: as.daily_budget ? parseFloat(as.daily_budget) : null,
              lifetimeBudget: as.lifetime_budget ? parseFloat(as.lifetime_budget) : null,
              targetingJson: as.targeting ? JSON.stringify(as.targeting) : null,
              status: as.status || 'UNKNOWN',
              effectiveStatus: as.effective_status || as.status || 'UNKNOWN',
              startTime: as.start_time ? new Date(as.start_time) : null,
              endTime: as.end_time ? new Date(as.end_time) : null,
              rawJson: JSON.stringify(as),
            },
            create: {
              adAccountId: dbAdAccount.id,
              campaignId: parentCampaignDbId,
              adsetId: as.id,
              adsetName: as.name || `AdSet ${as.id}`,
              optimizationGoal: as.optimization_goal || null,
              billingEvent: as.billing_event || null,
              bidStrategy: as.bid_strategy || null,
              dailyBudget: as.daily_budget ? parseFloat(as.daily_budget) : null,
              lifetimeBudget: as.lifetime_budget ? parseFloat(as.lifetime_budget) : null,
              targetingJson: as.targeting ? JSON.stringify(as.targeting) : null,
              status: as.status || 'UNKNOWN',
              effectiveStatus: as.effective_status || as.status || 'UNKNOWN',
              startTime: as.start_time ? new Date(as.start_time) : null,
              endTime: as.end_time ? new Date(as.end_time) : null,
              rawJson: JSON.stringify(as),
            },
          });
        }
      });

      // Map of existing AdSet IDs for foreign key lookup
      const adsetMap = new Map<string, string>();
      const dbAdSets = await prisma.adSet.findMany({
        where: { adAccountId: dbAdAccount.id },
        select: { id: true, adsetId: true },
      });
      dbAdSets.forEach(as => adsetMap.set(as.adsetId, as.id));

      // 9. Complete Ad Pagination & Idempotent Upsert (Batched)
      const adsResult = await MetaApiService.getAdsPaged(
        normalizedAccountId,
        connection,
        { limit: 50, maxPages: options.maxPages || 50 }
      );
      const ads = adsResult.data;

      await batchProcess(ads, 20, async (ad) => {
        const parentCampaignDbId = ad.campaign_id ? campaignMap.get(ad.campaign_id) : undefined;
        const parentAdSetDbId = ad.adset_id ? adsetMap.get(ad.adset_id) : undefined;

        if (parentCampaignDbId && parentAdSetDbId) {
          await prisma.ad.upsert({
            where: { adId: ad.id },
            update: {
              adName: ad.name || `Ad ${ad.id}`,
              creativeId: ad.creative?.id || null,
              status: ad.status || 'UNKNOWN',
              effectiveStatus: ad.effective_status || ad.status || 'UNKNOWN',
              createdTime: ad.created_time ? new Date(ad.created_time) : null,
              updatedTime: ad.updated_time ? new Date(ad.updated_time) : null,
              rawJson: JSON.stringify(ad),
            },
            create: {
              adAccountId: dbAdAccount.id,
              campaignId: parentCampaignDbId,
              adsetId: parentAdSetDbId,
              adId: ad.id,
              adName: ad.name || `Ad ${ad.id}`,
              creativeId: ad.creative?.id || null,
              status: ad.status || 'UNKNOWN',
              effectiveStatus: ad.effective_status || ad.status || 'UNKNOWN',
              createdTime: ad.created_time ? new Date(ad.created_time) : null,
              updatedTime: ad.updated_time ? new Date(ad.updated_time) : null,
              rawJson: JSON.stringify(ad),
            },
          });
        }
      });

      // Update progress stage
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 4/4] Đã lưu ${campaigns.length} Chiến dịch, ${adsets.length} Nhóm QC, ${ads.length} Mẫu QC. Đang lấy Daily Insights...`,
        },
      });

      // 10. Complete Daily Ad-Level Insights Pagination & Idempotent Upsert (Batched)
      const insightsResult = await MetaApiService.getInsightsPaged(
        normalizedAccountId,
        connection,
        'ad',
        dateFrom,
        dateTo,
        { limit: 100, maxPages: options.maxPages ? options.maxPages * 2 : 100 }
      );
      const dailyInsights = insightsResult.data;

      let totalSpend = 0;
      let totalImpressions = 0;
      let totalClicks = 0;

      // Filter valid insights
      const validInsights = dailyInsights.filter(insight => insight.ad_id && insight.date_start);

      // Pre-calculate aggregates
      for (const insight of validInsights) {
        totalSpend += parseFloat(insight.spend || '0');
        totalImpressions += parseInt(insight.impressions || '0', 10);
        totalClicks += parseInt(insight.clicks || '0', 10);
      }

      // Update progress stage before batch database persistence
      await prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          errorMessage: `[Giai đoạn 4/4] Đang ghi ${validInsights.length} bản ghi Daily Insights vào Neon PostgreSQL...`,
        },
      });

      // Batch upsert insights into database in chunks of 20
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
            actionsJson,
            costPerActionTypeJson,
            breakdownJson,
          },
        });
      });

      // 11. Expired Worker Protection: Ensure our job lease was not revoked or superseded
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

      return {
        success: true,
        jobId: syncJob.id,
        jobType,
        adAccountId: normalizedAccountId,
        accountName: accountInfo.accountName,
        dateRange: { since: dateFrom, until: dateTo },
        counts: {
          campaignsUpserted: campaigns.length,
          adsetsUpserted: adsets.length,
          adsUpserted: ads.length,
          insightsUpserted: validInsights.length,
        },
        metrics: {
          totalSpend: Math.round(totalSpend),
          totalImpressions,
          totalClicks,
        },
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const errorMsg = (error as Error).message || 'Unknown sync error';
      console.error(`Meta Sync failed for ${normalizedAccountId}:`, error);

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
