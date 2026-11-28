import test from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/db';
import { ReconciliationEngine } from '../src/lib/sync/reconciliationEngine';
import { MetaApiService } from '../src/lib/meta';
import { encrypt } from '../src/lib/crypto';

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

let mockInsightsDb: MockInsightDailyRecord[] = [];

// Mock prisma.insightsDaily.findMany
(prisma as unknown as { insightsDaily: unknown }).insightsDaily = {
  findMany: async ({
    where,
  }: {
    where?: {
      adAccount?: { accountId?: string };
      date?: { gte?: Date; lte?: Date };
    };
  }) => {
    return mockInsightsDb.filter((rec) => {
      if (where?.date?.gte && rec.date < where.date.gte) return false;
      if (where?.date?.lte && rec.date > where.date.lte) return false;
      return true;
    });
  },
};

const mockConnection = {
  id: 'conn_reconcile_test',
  encryptedAccessToken: encrypt('EAABwZCs1234567890abcdefghijklmnopqrstuvwxyz1234567890'),
  graphApiVersion: 'v25.0',
};

test('Task 2.5 (Test A): Seven-Day Reconciliation (2026-10-01 to 2026-10-07)', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';

  // 1. Setup mock daily insights in DB for Oct 1-7
  // Reference: Spend 55,231,230 VND, Impressions 1,303,507, Clicks 12,181, 90 insights
  const dailyMetrics = [
    { date: '2026-10-01', spend: 8763024, imp: 117842, clk: 1483, count: 14 },
    { date: '2026-10-02', spend: 7500000, imp: 180000, clk: 1600, count: 12 },
    { date: '2026-10-03', spend: 7800000, imp: 195000, clk: 1750, count: 13 },
    { date: '2026-10-04', spend: 8100000, imp: 210000, clk: 1900, count: 13 },
    { date: '2026-10-05', spend: 7400000, imp: 190000, clk: 1800, count: 12 },
    { date: '2026-10-06', spend: 7668206, imp: 200665, clk: 1848, count: 13 },
    { date: '2026-10-07', spend: 8000000, imp: 210000, clk: 1800, count: 13 },
  ];

  let totalSpend = 0;
  let totalImp = 0;
  let totalClk = 0;

  for (const dm of dailyMetrics) {
    totalSpend += dm.spend;
    totalImp += dm.imp;
    totalClk += dm.clk;

    // Distribute into records with exact remainder preservation
    let dayAccumSpend = 0;
    let dayAccumImp = 0;
    let dayAccumClk = 0;
    for (let i = 0; i < dm.count; i++) {
      const isLast = i === dm.count - 1;
      const recSpend = isLast ? dm.spend - dayAccumSpend : Math.floor(dm.spend / dm.count);
      const recImp = isLast ? dm.imp - dayAccumImp : Math.floor(dm.imp / dm.count);
      const recClk = isLast ? dm.clk - dayAccumClk : Math.floor(dm.clk / dm.count);
      dayAccumSpend += recSpend;
      dayAccumImp += recImp;
      dayAccumClk += recClk;

      mockInsightsDb.push({
        id: `ins_${dm.date}_${i}`,
        date: new Date(`${dm.date}T00:00:00.000Z`),
        adAccountId: 'ad_acc_uuid_1',
        campaignId: `camp_${i}`,
        campaignName: `Campaign ${i}`,
        adsetId: `adset_${i}`,
        adsetName: `AdSet ${i}`,
        adId: `ad_${dm.date}_${i}`,
        adName: `Ad ${i}`,
        level: 'ad',
        spend: recSpend,
        impressions: recImp,
        clicks: recClk,
      });
    }
  }

  // 2. Mock Meta API account-level responses
  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    MetaApiService.getInsightsPaged = (async (
      _accId: unknown,
      _conn: unknown,
      level: unknown
    ) => {
      assert.strictEqual(level, 'account');
      return {
        data: dailyMetrics.map((dm) => ({
          date_start: dm.date,
          date_stop: dm.date,
          spend: String(dm.spend),
          impressions: String(dm.imp),
          clicks: String(dm.clk),
        })),
        hasMore: false,
        pagesFetched: 1,
      };
    }) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => {
      return {
        spend: String(totalSpend),
        impressions: String(totalImp),
        clicks: String(totalClk),
      };
    }) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-07',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.overallStatus, 'MATCH');
    assert.strictEqual(result.dateRange.totalDays, 7);
    assert.strictEqual(result.totals.spend.difference, 0);
    assert.strictEqual(result.totals.impressions.difference, 0);
    assert.strictEqual(result.totals.clicks.difference, 0);
    assert.strictEqual(result.totals.neonInsightsCount, 90);
    assert.strictEqual(result.dailyBreakdown.length, 7);
    assert.ok(result.dailyBreakdown.every((d) => d.status === 'MATCH'));
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});

test('Task 2.5 (Test B): Full-Month Reconciliation (2026-10-01 to 2026-10-31, 31 dates)', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';

  // Reference: Spend 293,127,866 VND, Impressions 4,508,895, Clicks 68,567, 476 insights
  const totalDays = 31;
  const targetSpend = 293127866;
  const targetImp = 4508895;
  const targetClk = 68567;
  const targetInsights = 476;

  const mockDailyData: Array<{ date: string; spend: number; imp: number; clk: number }> = [];
  let accumSpend = 0;
  let accumImp = 0;
  let accumClk = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dStr = `2026-10-${String(d).padStart(2, '0')}`;
    const dSpend = d === totalDays ? targetSpend - accumSpend : Math.round(targetSpend / totalDays);
    const dImp = d === totalDays ? targetImp - accumImp : Math.round(targetImp / totalDays);
    const dClk = d === totalDays ? targetClk - accumClk : Math.round(targetClk / totalDays);

    accumSpend += dSpend;
    accumImp += dImp;
    accumClk += dClk;

    mockDailyData.push({ date: dStr, spend: dSpend, imp: dImp, clk: dClk });

    // Populate mock DB with exact remainder preservation
    const countForDay = Math.floor(targetInsights / totalDays) + (d <= targetInsights % totalDays ? 1 : 0);
    let dayAccumSpend = 0;
    let dayAccumImp = 0;
    let dayAccumClk = 0;
    for (let i = 0; i < countForDay; i++) {
      const isLast = i === countForDay - 1;
      const recSpend = isLast ? dSpend - dayAccumSpend : Math.floor(dSpend / countForDay);
      const recImp = isLast ? dImp - dayAccumImp : Math.floor(dImp / countForDay);
      const recClk = isLast ? dClk - dayAccumClk : Math.floor(dClk / countForDay);
      dayAccumSpend += recSpend;
      dayAccumImp += recImp;
      dayAccumClk += recClk;

      mockInsightsDb.push({
        id: `ins_${dStr}_${i}`,
        date: new Date(`${dStr}T00:00:00.000Z`),
        adAccountId: 'ad_acc_uuid_1',
        campaignId: `camp_${i}`,
        campaignName: `Campaign ${i}`,
        adsetId: `adset_${i}`,
        adsetName: `AdSet ${i}`,
        adId: `ad_${dStr}_${i}`,
        adName: `Ad ${i}`,
        level: 'ad',
        spend: recSpend,
        impressions: recImp,
        clicks: recClk,
      });
    }
  }

  assert.strictEqual(mockInsightsDb.length, targetInsights);

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    MetaApiService.getInsightsPaged = (async () => ({
      data: mockDailyData.map((d) => ({
        date_start: d.date,
        date_stop: d.date,
        spend: String(d.spend),
        impressions: String(d.imp),
        clicks: String(d.clk),
      })),
      hasMore: false,
      pagesFetched: 1,
    })) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => ({
      spend: String(targetSpend),
      impressions: String(targetImp),
      clicks: String(targetClk),
    })) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.overallStatus, 'MATCH');
    assert.strictEqual(result.dateRange.totalDays, 31);
    assert.strictEqual(result.totals.spend.meta, targetSpend);
    assert.strictEqual(result.totals.spend.neon, targetSpend);
    assert.strictEqual(result.totals.spend.difference, 0);
    assert.strictEqual(result.totals.impressions.difference, 0);
    assert.strictEqual(result.totals.clicks.difference, 0);
    assert.strictEqual(result.totals.neonInsightsCount, 476);
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});

test('Task 2.5 (Test C): Controlled Metric Mismatch accurately calculates difference', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';
  const testDate = '2026-10-05';

  // Neon has 8,000,000 VND spend
  mockInsightsDb.push({
    id: 'ins_diff_01',
    date: new Date(`${testDate}T00:00:00.000Z`),
    adAccountId: 'ad_acc_uuid_1',
    campaignId: 'camp_1',
    campaignName: 'Campaign 1',
    adsetId: 'adset_1',
    adsetName: 'AdSet 1',
    adId: 'ad_diff_1',
    adName: 'Ad 1',
    level: 'ad',
    spend: 8000000,
    impressions: 100000,
    clicks: 1000,
  });

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    // Meta API reports 8,500,000 VND (500,000 VND higher)
    MetaApiService.getInsightsPaged = (async () => ({
      data: [
        {
          date_start: testDate,
          date_stop: testDate,
          spend: '8500000',
          impressions: '100000',
          clicks: '1000',
        },
      ],
      hasMore: false,
      pagesFetched: 1,
    })) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => ({
      spend: '8500000',
      impressions: '100000',
      clicks: '1000',
    })) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: testDate,
      dateTo: testDate,
    });

    assert.strictEqual(result.overallStatus, 'MISMATCH');
    assert.strictEqual(result.totals.spend.difference, -500000);
    assert.strictEqual(result.totals.spend.match, false);
    assert.strictEqual(result.totals.impressions.difference, 0);
    assert.strictEqual(result.totals.impressions.match, true);
    assert.strictEqual(result.dailyBreakdown[0].status, 'MISMATCH');
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});

test('Task 2.5 (Test D): Missing Date reports INCOMPLETE rather than MATCH or zero', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';

  // Only Oct 1 has data in Neon; Oct 2 is missing
  mockInsightsDb.push({
    id: 'ins_d1',
    date: new Date('2026-10-01T00:00:00.000Z'),
    adAccountId: 'ad_acc_uuid_1',
    campaignId: 'camp_1',
    campaignName: 'Campaign 1',
    adsetId: 'adset_1',
    adsetName: 'AdSet 1',
    adId: 'ad_1',
    adName: 'Ad 1',
    level: 'ad',
    spend: 5000000,
    impressions: 80000,
    clicks: 800,
  });

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    MetaApiService.getInsightsPaged = (async () => ({
      data: [
        { date_start: '2026-10-01', date_stop: '2026-10-01', spend: '5000000', impressions: '80000', clicks: '800' },
        { date_start: '2026-10-02', date_stop: '2026-10-02', spend: '6000000', impressions: '90000', clicks: '900' },
      ],
      hasMore: false,
      pagesFetched: 1,
    })) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => ({
      spend: '11000000',
      impressions: '170000',
      clicks: '1700',
    })) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-02',
    });

    assert.strictEqual(result.overallStatus, 'INCOMPLETE');
    assert.strictEqual(result.integrity.missingDates.length, 1);
    assert.strictEqual(result.integrity.missingDates[0], '2026-10-02');
    assert.strictEqual(result.dailyBreakdown[1].status, 'INCOMPLETE');
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});

test('Task 2.5 (Test E): Duplicate Detection identifies logical duplicates', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';
  const testDate = '2026-10-01';

  // Inject 2 records with the EXACT same adId, date, level
  mockInsightsDb.push(
    {
      id: 'ins_dup_1',
      date: new Date(`${testDate}T00:00:00.000Z`),
      adAccountId: 'ad_acc_uuid_1',
      campaignId: 'camp_1',
      campaignName: 'Campaign 1',
      adsetId: 'adset_1',
      adsetName: 'AdSet 1',
      adId: 'ad_dup_target',
      adName: 'Duplicate Ad Target',
      level: 'ad',
      spend: 2500000,
      impressions: 40000,
      clicks: 400,
    },
    {
      id: 'ins_dup_2',
      date: new Date(`${testDate}T00:00:00.000Z`),
      adAccountId: 'ad_acc_uuid_1',
      campaignId: 'camp_1',
      campaignName: 'Campaign 1',
      adsetId: 'adset_1',
      adsetName: 'AdSet 1',
      adId: 'ad_dup_target',
      adName: 'Duplicate Ad Target',
      level: 'ad',
      spend: 2500000,
      impressions: 40000,
      clicks: 400,
    }
  );

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    MetaApiService.getInsightsPaged = (async () => ({
      data: [{ date_start: testDate, date_stop: testDate, spend: '5000000', impressions: '80000', clicks: '800' }],
      hasMore: false,
      pagesFetched: 1,
    })) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => ({
      spend: '5000000',
      impressions: '80000',
      clicks: '800',
    })) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: testDate,
      dateTo: testDate,
    });

    assert.strictEqual(result.integrity.hasDuplicates, true);
    assert.strictEqual(result.integrity.duplicateCount, 1);
    assert.strictEqual(result.integrity.duplicateSamples[0].adId, 'ad_dup_target');
    assert.strictEqual(result.overallStatus, 'MISMATCH');
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});

test('Task 2.5 (Test F): API Failure returns ERROR and cannot be mistaken for MATCH', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;

  try {
    MetaApiService.getInsightsPaged = (async () => {
      throw new Error('Meta Graph API rate limit exceeded (Code 17)');
    }) as unknown as typeof MetaApiService.getInsightsPaged;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-07',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.overallStatus, 'ERROR');
    assert.match(result.error || '', /rate limit exceeded/);
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
  }
});

test('Task 2.5 (Test G): Offsetting Daily Discrepancies still reports MISMATCH', async () => {
  mockInsightsDb = [];
  const accountId = 'act_1380498158917028';

  // Day 1: Neon has 6,000,000 (+1,000,000)
  // Day 2: Neon has 4,000,000 (-1,000,000)
  // Total Neon = 10,000,000. Total Meta = 10,000,000.
  // Totals match! But individual dates mismatch!
  mockInsightsDb.push(
    {
      id: 'ins_off_1',
      date: new Date('2026-10-01T00:00:00.000Z'),
      adAccountId: 'ad_acc_uuid_1',
      campaignId: 'camp_1',
      campaignName: 'Campaign 1',
      adsetId: 'adset_1',
      adsetName: 'AdSet 1',
      adId: 'ad_1',
      adName: 'Ad 1',
      level: 'ad',
      spend: 6000000,
      impressions: 50000,
      clicks: 500,
    },
    {
      id: 'ins_off_2',
      date: new Date('2026-10-02T00:00:00.000Z'),
      adAccountId: 'ad_acc_uuid_1',
      campaignId: 'camp_2',
      campaignName: 'Campaign 2',
      adsetId: 'adset_2',
      adsetName: 'AdSet 2',
      adId: 'ad_2',
      adName: 'Ad 2',
      level: 'ad',
      spend: 4000000,
      impressions: 50000,
      clicks: 500,
    }
  );

  const origGetInsightsPaged = MetaApiService.getInsightsPaged;
  const origGetAccountInsights = MetaApiService.getAccountInsights;

  try {
    MetaApiService.getInsightsPaged = (async () => ({
      data: [
        { date_start: '2026-10-01', date_stop: '2026-10-01', spend: '5000000', impressions: '50000', clicks: '500' },
        { date_start: '2026-10-02', date_stop: '2026-10-02', spend: '5000000', impressions: '50000', clicks: '500' },
      ],
      hasMore: false,
      pagesFetched: 1,
    })) as unknown as typeof MetaApiService.getInsightsPaged;

    MetaApiService.getAccountInsights = (async () => ({
      spend: '10000000',
      impressions: '100000',
      clicks: '1000',
    })) as unknown as typeof MetaApiService.getAccountInsights;

    const result = await ReconciliationEngine.reconcile(mockConnection, {
      adAccountId: accountId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-02',
    });

    // Total spend matches (0 difference)
    assert.strictEqual(result.totals.spend.difference, 0);
    assert.strictEqual(result.totals.spend.match, true);

    // BUT overallStatus MUST be MISMATCH because date 1 and date 2 differed!
    assert.strictEqual(result.overallStatus, 'MISMATCH');
    assert.strictEqual(result.dailyBreakdown[0].status, 'MISMATCH');
    assert.strictEqual(result.dailyBreakdown[0].spend.difference, 1000000);
    assert.strictEqual(result.dailyBreakdown[1].status, 'MISMATCH');
    assert.strictEqual(result.dailyBreakdown[1].spend.difference, -1000000);
  } finally {
    MetaApiService.getInsightsPaged = origGetInsightsPaged;
    MetaApiService.getAccountInsights = origGetAccountInsights;
  }
});
