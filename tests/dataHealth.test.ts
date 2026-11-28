import test from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/db';
import { DataHealthService } from '../src/lib/sync/dataHealthService';

// In-memory mock store for InsightsDaily
interface MockInsightDailyRecord {
  id: string;
  date: Date;
  adAccountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  level: string;
  spend: number;
  impressions: number;
  clicks: number;
}

// In-memory mock store for SyncCheckpoint
interface MockSyncCheckpointRecord {
  id: string;
  adAccountId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

// In-memory mock store for SyncJob
interface MockSyncJobRecord {
  id: string;
  adAccountId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  startedAt: Date;
  completedAt?: Date | null;
}

let mockInsightsDb: MockInsightDailyRecord[] = [];
let mockCheckpointsDb: MockSyncCheckpointRecord[] = [];
let mockSyncJobsDb: MockSyncJobRecord[] = [];

// Setup Prisma Mocks
(prisma as unknown as { insightsDaily: unknown }).insightsDaily = {
  findMany: async ({
    where,
  }: {
    where?: {
      adAccount?: { accountId?: string };
      date?: { gte?: Date; lte?: Date };
      level?: string;
    };
  }) => {
    return mockInsightsDb.filter((rec) => {
      if (where?.date?.gte && rec.date < where.date.gte) return false;
      if (where?.date?.lte && rec.date > where.date.lte) return false;
      if (where?.level && rec.level !== where.level) return false;
      return true;
    });
  },
};

(prisma as unknown as { syncCheckpoint: unknown }).syncCheckpoint = {
  findMany: async ({
    where,
  }: {
    where?: {
      adAccountId?: string;
      reportingDate?: { in?: string[] };
    };
  }) => {
    return mockCheckpointsDb.filter((rec) => {
      if (where?.adAccountId && rec.adAccountId !== where.adAccountId) return false;
      if (where?.reportingDate?.in && !where.reportingDate.in.includes(rec.reportingDate)) return false;
      return true;
    });
  },
};

(prisma as unknown as { syncJob: unknown }).syncJob = {
  findFirst: async ({
    where,
  }: {
    where?: {
      adAccountId?: string;
      status?: string;
      startedAt?: { gte?: Date };
    };
  }) => {
    return (
      mockSyncJobsDb.find((rec) => {
        if (where?.adAccountId && rec.adAccountId !== where.adAccountId) return false;
        if (where?.status && rec.status !== where.status) return false;
        if (where?.startedAt?.gte && rec.startedAt < where.startedAt.gte) return false;
        return true;
      }) || null
    );
  },
};

(prisma as unknown as { adAccount: unknown }).adAccount = {
  findUnique: async () => {
    return {
      accountId: 'act_1380498158917028',
      timezoneName: 'Asia/Ho_Chi_Minh',
      metaConnection: {
        syncStartDate: '2026-05-15',
      },
    };
  },
};

const ACCOUNT_ID = 'act_1380498158917028';

test('Task 2.6 (Test A): Verified Historical Month (GIS Hà Nội, Oct 2026)', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  // Populate 31 dates of October 2026 matching verified monthly run:
  // 476 insights, 293,127,866 VND, 4,508,895 imp, 68,567 clicks
  const totalTargetSpend = 293127866;
  const totalTargetImp = 4508895;
  const totalTargetClk = 68567;
  const totalTargetInsights = 476;

  let accumulatedSpend = 0;
  let accumulatedImp = 0;
  let accumulatedClk = 0;
  let accumulatedInsights = 0;

  for (let day = 1; day <= 31; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const dateStr = `2026-10-${dayStr}`;
    const isLastDay = day === 31;

    const dayInsights = isLastDay
      ? totalTargetInsights - accumulatedInsights
      : Math.floor(totalTargetInsights / 31);
    const daySpend = isLastDay
      ? totalTargetSpend - accumulatedSpend
      : Math.floor(totalTargetSpend / 31);
    const dayImp = isLastDay
      ? totalTargetImp - accumulatedImp
      : Math.floor(totalTargetImp / 31);
    const dayClk = isLastDay
      ? totalTargetClk - accumulatedClk
      : Math.floor(totalTargetClk / 31);

    accumulatedInsights += dayInsights;
    accumulatedSpend += daySpend;
    accumulatedImp += dayImp;
    accumulatedClk += dayClk;

    let subSpend = 0;
    let subImp = 0;
    let subClk = 0;

    for (let i = 0; i < dayInsights; i++) {
      const isLastRec = i === dayInsights - 1;
      const rSpend = isLastRec ? daySpend - subSpend : Math.floor(daySpend / dayInsights);
      const rImp = isLastRec ? dayImp - subImp : Math.floor(dayImp / dayInsights);
      const rClk = isLastRec ? dayClk - subClk : Math.floor(dayClk / dayInsights);
      subSpend += rSpend;
      subImp += rImp;
      subClk += rClk;

      mockInsightsDb.push({
        id: `ins_${dateStr}_${i}`,
        date: new Date(`${dateStr}T00:00:00.000Z`),
        adAccountId: ACCOUNT_ID,
        campaignId: `camp_${i}`,
        campaignName: `Campaign ${i}`,
        adsetId: `adset_${i}`,
        adsetName: `AdSet ${i}`,
        adId: `ad_${dateStr}_${i}`,
        adName: `Ad ${i}`,
        level: 'ad',
        spend: rSpend,
        impressions: rImp,
        clicks: rClk,
      });
    }

    // Add corresponding SyncCheckpoint with MATCH reconciliation evidence
    const nowIso = new Date('2026-11-20T10:00:00.000Z');
    mockCheckpointsDb.push({
      id: `cp_${dateStr}`,
      adAccountId: ACCOUNT_ID,
      reportingDate: dateStr,
      status: 'SUCCESS',
      completedAt: nowIso,
      recordCount: dayInsights,
      spend: daySpend,
      impressions: dayImp,
      clicks: dayClk,
      isEmptyDay: false,
      lastError: null,
      retryEligible: true,
      nextEligibleAt: null,
      syncJobId: 'job_47dcdfb6',
      metadataJson: JSON.stringify({
        reconciliation: {
          status: 'MATCH',
          verifiedAt: '2026-11-20T10:05:00.000Z',
          spendDiff: 0,
          impressionsDiff: 0,
          clicksDiff: 0,
          metaSpend: daySpend,
          neonSpend: daySpend,
        },
      }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.dateRange.totalDays, 31);
  assert.strictEqual(result.summary.totalExpected, 31);
  assert.strictEqual(result.summary.verified, 31);
  assert.strictEqual(result.summary.unverified, 0);
  assert.strictEqual(result.summary.mismatch, 0);
  assert.strictEqual(result.summary.failed, 0);
  assert.strictEqual(result.summary.missing, 0);
  assert.strictEqual(result.summary.totalInsights, 476);
  assert.strictEqual(result.summary.totalSpend, 293127866);
  assert.strictEqual(result.summary.totalImpressions, 4508895);
  assert.strictEqual(result.summary.totalClicks, 68567);
  assert.strictEqual(result.integrity.mixedLevelFiltered, true);
  assert.strictEqual(result.integrity.duplicateCount, 0);
});

test('Task 2.6 (Test B): Missing Date Detection', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  // Date 2026-10-01 has data & checkpoint
  mockInsightsDb.push({
    id: 'ins_1',
    date: new Date('2026-10-01T00:00:00.000Z'),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: 'a1',
    adName: 'A1',
    level: 'ad',
    spend: 1000,
    impressions: 100,
    clicks: 10,
  });

  mockCheckpointsDb.push({
    id: 'cp_2026-10-01',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-01',
    status: 'SUCCESS',
    completedAt: new Date(),
    recordCount: 1,
    spend: 1000,
    impressions: 100,
    clicks: 10,
    isEmptyDay: false,
    lastError: null,
    retryEligible: true,
    nextEligibleAt: null,
    syncJobId: 'job_1',
    metadataJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Date 2026-10-02 has NO checkpoint and NO insights in DB
  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-01',
    dateTo: '2026-10-02',
  });

  assert.strictEqual(result.summary.totalExpected, 2);
  const day2 = result.dates.find((d) => d.reportingDate === '2026-10-02');
  assert.ok(day2);
  assert.strictEqual(day2.displayStatus, 'MISSING');
  assert.strictEqual(day2.syncStatus, 'NONE');
  assert.strictEqual(day2.insightsCount, 0);
  assert.strictEqual(result.summary.missing, 1);
});

test('Task 2.6 (Test C): Synchronization Failure Reporting', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  mockCheckpointsDb.push({
    id: 'cp_failed',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-05',
    status: 'FAILED',
    completedAt: null,
    recordCount: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    isEmptyDay: false,
    lastError: 'Meta API Error 2: Temporary service outage',
    retryEligible: true,
    nextEligibleAt: new Date(Date.now() + 60000),
    syncJobId: 'job_failed_123',
    metadataJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-05',
    dateTo: '2026-10-05',
  });

  assert.strictEqual(result.summary.failed, 1);
  const item = result.dates[0];
  assert.strictEqual(item.displayStatus, 'FAILED');
  assert.strictEqual(item.syncStatus, 'FAILED');
  assert.strictEqual(item.latestJobId, 'job_failed_123');
  assert.ok(item.lastError?.includes('Meta API Error 2'));
  assert.strictEqual(item.retryEligible, true);
  assert.ok(item.nextEligibleAt !== null);
});

test('Task 2.6 (Test D): Reconciliation Mismatch Reporting', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  mockInsightsDb.push({
    id: 'ins_mismatch',
    date: new Date('2026-10-10T00:00:00.000Z'),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: 'a1',
    adName: 'A1',
    level: 'ad',
    spend: 5000000,
    impressions: 50000,
    clicks: 500,
  });

  mockCheckpointsDb.push({
    id: 'cp_mismatch',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-10',
    status: 'SUCCESS',
    completedAt: new Date('2026-11-20T10:00:00.000Z'),
    recordCount: 1,
    spend: 5000000,
    impressions: 50000,
    clicks: 500,
    isEmptyDay: false,
    lastError: null,
    retryEligible: true,
    nextEligibleAt: null,
    syncJobId: 'job_mismatch',
    metadataJson: JSON.stringify({
      reconciliation: {
        status: 'MISMATCH',
        verifiedAt: '2026-11-20T10:05:00.000Z',
        spendDiff: 500000, // Meta had 5,500,000
        impressionsDiff: 1000,
        clicksDiff: 20,
      },
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-10',
    dateTo: '2026-10-10',
  });

  assert.strictEqual(result.summary.mismatch, 1);
  const item = result.dates[0];
  assert.strictEqual(item.displayStatus, 'MISMATCH');
  assert.strictEqual(item.verificationStatus, 'MISMATCH');
  assert.strictEqual(item.metricDifferences?.spendDiff, 500000);
  assert.strictEqual(item.metricDifferences?.impressionsDiff, 1000);
  assert.strictEqual(item.metricDifferences?.clicksDiff, 20);
});

test('Task 2.6 (Test E): Successful Empty Day Handling', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  mockCheckpointsDb.push({
    id: 'cp_empty',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-15',
    status: 'SUCCESS',
    completedAt: new Date('2026-11-20T10:00:00.000Z'),
    recordCount: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    isEmptyDay: true,
    lastError: null,
    retryEligible: true,
    nextEligibleAt: null,
    syncJobId: 'job_empty',
    metadataJson: JSON.stringify({
      reconciliation: {
        status: 'EMPTY_DAY',
        verifiedAt: '2026-11-20T10:05:00.000Z',
        spendDiff: 0,
        impressionsDiff: 0,
        clicksDiff: 0,
      },
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-15',
    dateTo: '2026-10-15',
  });

  const item = result.dates[0];
  assert.strictEqual(item.isEmptyDay, true);
  assert.strictEqual(item.displayStatus, 'VERIFIED');
  assert.strictEqual(item.spend, 0);
  assert.strictEqual(item.insightsCount, 0);
  assert.strictEqual(result.summary.missing, 0);
  assert.strictEqual(result.summary.verified, 1);
});

test('Task 2.6 (Test F): Historical Partial Job Superseded by Completed Checkpoint', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  // An older partial job exists in history
  mockSyncJobsDb.push({
    id: 'job_partial_old',
    adAccountId: ACCOUNT_ID,
    status: 'partial',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    startedAt: new Date(Date.now() - 3600000), // 1 hour ago
    completedAt: new Date(Date.now() - 3500000),
  });

  // But the checkpoint for this date succeeded subsequently
  mockCheckpointsDb.push({
    id: 'cp_resumed',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-25',
    status: 'SUCCESS',
    completedAt: new Date(),
    recordCount: 15,
    spend: 9000000,
    impressions: 120000,
    clicks: 2000,
    isEmptyDay: false,
    lastError: null,
    retryEligible: true,
    nextEligibleAt: null,
    syncJobId: 'job_resumed_new',
    metadataJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  mockInsightsDb.push({
    id: 'ins_resumed',
    date: new Date('2026-10-25T00:00:00.000Z'),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: 'a1',
    adName: 'A1',
    level: 'ad',
    spend: 9000000,
    impressions: 120000,
    clicks: 2000,
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-25',
    dateTo: '2026-10-25',
  });

  const item = result.dates[0];
  // Checkpoint is SUCCESS, not running or failed
  assert.strictEqual(item.syncStatus, 'SUCCESS');
  assert.strictEqual(item.displayStatus, 'UNVERIFIED'); // no reconciliation metadata yet
  assert.strictEqual(result.summary.inProgress, 0);
  assert.strictEqual(result.summary.failed, 0);
});

test('Task 2.6 (Test G): Freshness / Stale Invalidation When Re-synchronized', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  // Checkpoint synchronized at 12:00:00, but reconciliation was done earlier at 10:00:00
  const syncTime = new Date('2026-11-20T12:00:00.000Z');
  const priorVerifyTime = '2026-11-20T10:00:00.000Z';

  mockCheckpointsDb.push({
    id: 'cp_stale',
    adAccountId: ACCOUNT_ID,
    reportingDate: '2026-10-18',
    status: 'SUCCESS',
    completedAt: syncTime,
    recordCount: 10,
    spend: 6000000,
    impressions: 90000,
    clicks: 1500,
    isEmptyDay: false,
    lastError: null,
    retryEligible: true,
    nextEligibleAt: null,
    syncJobId: 'job_refresh',
    metadataJson: JSON.stringify({
      reconciliation: {
        status: 'MATCH',
        verifiedAt: priorVerifyTime, // older than syncTime!
        spendDiff: 0,
        impressionsDiff: 0,
        clicksDiff: 0,
      },
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  mockInsightsDb.push({
    id: 'ins_stale',
    date: new Date('2026-10-18T00:00:00.000Z'),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: 'a1',
    adName: 'A1',
    level: 'ad',
    spend: 6000000,
    impressions: 90000,
    clicks: 1500,
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-10-18',
    dateTo: '2026-10-18',
  });

  const item = result.dates[0];
  assert.strictEqual(item.displayStatus, 'STALE');
  assert.strictEqual(item.verificationStatus, 'UNVERIFIED');
  assert.strictEqual(result.summary.stale, 1);
});

test('Task 2.6 (Test H): Date Boundaries (Future & Pre-Start Exclusion)', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  // Range spanning before syncStartDate (2026-05-15) and future dates (e.g. 2030-01-01)
  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: '2026-05-10',
    dateTo: '2026-05-16',
    syncStartDate: '2026-05-15',
  });

  // Dates 2026-05-10 through 2026-05-14 are before start (5 dates)
  // Dates 2026-05-15 and 2026-05-16 are on/after start (2 dates)
  const preStart = result.dates.filter((d) => d.isBeforeStart);
  assert.strictEqual(preStart.length, 5);
  for (const ps of preStart) {
    assert.strictEqual(ps.isBeforeStart, true);
  }

  // totalExpected should only count dates that are neither future nor before start
  assert.strictEqual(result.summary.totalExpected, 2);
});

test('Task 2.6 (Test I): Strict Ad-Level Aggregation (Level = ad)', async () => {
  mockInsightsDb = [];
  mockCheckpointsDb = [];
  mockSyncJobsDb = [];

  const targetDate = '2026-10-20';

  // 1 Ad level record
  mockInsightsDb.push({
    id: 'ins_ad',
    date: new Date(`${targetDate}T00:00:00.000Z`),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: 'ad_123',
    adName: 'Ad 123',
    level: 'ad',
    spend: 1000000,
    impressions: 10000,
    clicks: 100,
  });

  // 1 Campaign level record with same spend (which would cause 2x double counting if not filtered)
  mockInsightsDb.push({
    id: 'ins_camp',
    date: new Date(`${targetDate}T00:00:00.000Z`),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: '',
    adsetName: '',
    adId: '',
    adName: '',
    level: 'campaign',
    spend: 1000000,
    impressions: 10000,
    clicks: 100,
  });

  // 1 AdSet level record
  mockInsightsDb.push({
    id: 'ins_adset',
    date: new Date(`${targetDate}T00:00:00.000Z`),
    adAccountId: ACCOUNT_ID,
    campaignId: 'c1',
    campaignName: 'C1',
    adsetId: 's1',
    adsetName: 'S1',
    adId: '',
    adName: '',
    level: 'adset',
    spend: 1000000,
    impressions: 10000,
    clicks: 100,
  });

  const result = await DataHealthService.getDataHealth({
    adAccountId: ACCOUNT_ID,
    dateFrom: targetDate,
    dateTo: targetDate,
  });

  const item = result.dates[0];
  // Must ONLY aggregate level: 'ad', so spend = 1,000,000, not 3,000,000!
  assert.strictEqual(item.insightsCount, 1);
  assert.strictEqual(item.spend, 1000000);
  assert.strictEqual(item.impressions, 10000);
  assert.strictEqual(item.clicks, 100);
  assert.strictEqual(result.integrity.mixedLevelFiltered, true);
  assert.strictEqual(result.integrity.duplicateCount, 0);
});
