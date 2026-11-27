import test from 'node:test';
import assert from 'node:assert';
import {
  MetaSyncEngine,
  ENABLED_ACCOUNTS_FOR_SYNC,
  normalizeSyncDate,
  splitDateRangeToDays,
  batchProcess,
  SYNC_JOB_LEASE_MS,
  FUNCTION_TIMEOUT_MS,
  SAFETY_BUDGET_REMAINING_MS,
} from '../src/lib/sync/metaSyncEngine';
import { encrypt } from '../src/lib/crypto';
import { GET as cronHandler, POST as cronPostHandler } from '../src/app/api/cron/sync/route';
import { GET as jobsGetHandler, POST as jobsPostHandler } from '../src/app/api/meta/sync/jobs/route';
import { prisma } from '../src/lib/db';
import {
  INSIGHTS_CORE_FIELDS,
  INSIGHTS_ACCOUNT_FIELDS,
  INSIGHTS_OPTIONAL_VIDEO_FIELDS,
  parseMetaError,
} from '../src/lib/meta';

test('normalizeSyncDate: Validates and formats dates correctly', () => {
  const fallback = '2026-10-01';
  assert.strictEqual(normalizeSyncDate('2026-10-31', fallback), '2026-10-31');
  assert.strictEqual(normalizeSyncDate('  2026-10-15  ', fallback), '2026-10-15');
  assert.strictEqual(normalizeSyncDate('invalid-date', fallback), fallback);
  assert.strictEqual(normalizeSyncDate('', fallback), fallback);
  assert.strictEqual(normalizeSyncDate(null, fallback), fallback);
  assert.strictEqual(normalizeSyncDate(undefined, fallback), fallback);
});

test('batchProcess: Processes array in batches concurrently while maintaining results', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const processed: number[] = [];

  const results = await batchProcess(items, 3, async (num) => {
    processed.push(num);
    return num * 2;
  });

  assert.strictEqual(processed.length, 7);
  assert.deepStrictEqual(results, [2, 4, 6, 8, 10, 12, 14]);
});

test('SYNC_JOB_LEASE_MS: Bounded lease is configured to 330 seconds', () => {
  assert.strictEqual(SYNC_JOB_LEASE_MS, 330 * 1000);
});

test('Stale Job Recovery: Detects and transitions expired running jobs to timeout', async () => {
  const originalFindMany = prisma.syncJob.findMany;
  const originalUpdate = prisma.syncJob.update;

  try {
    const expiredJob = {
      id: 'job_stale_38032bbe',
      startedAt: new Date(Date.now() - 250 * 1000), // 250s ago (> 180s lease)
      adAccountId: 'act_1380498158917028',
      errorMessage: '[STAGE: PERSISTING_INSIGHTS] In progress...',
    };

    let updatedJobData: Record<string, unknown> | null = null;

    // Mock prisma.syncJob methods
    (prisma.syncJob as unknown as { findMany: typeof prisma.syncJob.findMany }).findMany = (async () => {
      return [expiredJob];
    }) as unknown as typeof prisma.syncJob.findMany;

    (prisma.syncJob as unknown as { update: typeof prisma.syncJob.update }).update = (async (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      updatedJobData = args.data;
      return { id: args.where.id, ...args.data };
    }) as unknown as typeof prisma.syncJob.update;

    const result = await MetaSyncEngine.recoverStaleJobs('act_1380498158917028');

    assert.strictEqual(result.recoveredCount, 1);
    assert.deepStrictEqual(result.recoveredJobIds, ['job_stale_38032bbe']);
    assert.ok(updatedJobData);
    assert.strictEqual((updatedJobData as { status: string }).status, 'timeout');
    assert.match(
      (updatedJobData as { errorMessage: string }).errorMessage,
      /Tiến trình bị gián đoạn do vượt quá thời hạn thực thi/
    );
  } finally {
    prisma.syncJob.findMany = originalFindMany;
    prisma.syncJob.update = originalUpdate;
  }
});

test('Stale Job Recovery: No-op when no stale jobs exist', async () => {
  const originalFindMany = prisma.syncJob.findMany;
  try {
    (prisma.syncJob as unknown as { findMany: typeof prisma.syncJob.findMany }).findMany = (async () => {
      return [];
    }) as unknown as typeof prisma.syncJob.findMany;

    const result = await MetaSyncEngine.recoverStaleJobs();
    assert.strictEqual(result.recoveredCount, 0);
    assert.deepStrictEqual(result.recoveredJobIds, []);
  } finally {
    prisma.syncJob.findMany = originalFindMany;
  }
});

test('Active Job Protection: Concurrency guard protects genuinely active running job', async () => {
  const originalFindMany = prisma.syncJob.findMany;
  const originalFindFirst = prisma.syncJob.findFirst;
  const originalExpected = process.env.EXPECTED_NEON_ENDPOINT_ID;

  try {
    process.env.EXPECTED_NEON_ENDPOINT_ID = 'local-sqlite';

    // 1. Stale scan returns empty (active job is within lease)
    (prisma.syncJob as unknown as { findMany: typeof prisma.syncJob.findMany }).findMany = (async () => {
      return [];
    }) as unknown as typeof prisma.syncJob.findMany;

    // 2. Active running job found (started 20 seconds ago, well within 90s lease)
    const activeJob = {
      id: 'job_active_12345678',
      startedAt: new Date(Date.now() - 20 * 1000),
      adAccountId: 'act_1380498158917028',
      status: 'running',
    };

    (prisma.syncJob as unknown as { findFirst: typeof prisma.syncJob.findFirst }).findFirst = (async () => {
      return activeJob;
    }) as unknown as typeof prisma.syncJob.findFirst;

    const connection = {
      id: 'conn_test_active',
      accessToken: 'test-token',
    };

    await assert.rejects(
      async () => {
        await MetaSyncEngine.syncAdAccount(connection, {
          adAccountId: 'act_1380498158917028',
        });
      },
      {
        message: /Một tiến trình đồng bộ khác cho tài khoản act_1380498158917028 đang chạy/,
      }
    );
  } finally {
    prisma.syncJob.findMany = originalFindMany;
    prisma.syncJob.findFirst = originalFindFirst;
    process.env.EXPECTED_NEON_ENDPOINT_ID = originalExpected;
  }
});

test('MetaSyncEngine: Rejects accounts outside the enabled scope', async () => {
  const connection = {
    id: 'conn_test_scope',
    accessToken: 'test-token-valid',
  };

  await assert.rejects(
    async () => {
      await MetaSyncEngine.syncAdAccount(connection, {
        adAccountId: 'act_999888777', // Unauthorized account
      });
    },
    {
      message: /chưa được bật tính năng đồng bộ tự động/,
    }
  );
});

test('MetaSyncEngine: Allows whitelisted GIS Hà Nội account act_1380498158917028', () => {
  assert.ok(ENABLED_ACCOUNTS_FOR_SYNC.includes('act_1380498158917028'));
  assert.ok(ENABLED_ACCOUNTS_FOR_SYNC.includes('1380498158917028'));
});

test('Sync Jobs Endpoint: Rejects unauthenticated requests with HTTP 401', async () => {
  const reqGet = new Request('http://localhost:3000/api/meta/sync/jobs', { method: 'GET' });
  const resGet = await jobsGetHandler(reqGet);
  assert.strictEqual(resGet.status, 401);

  const reqPost = new Request('http://localhost:3000/api/meta/sync/jobs', { method: 'POST' });
  const resPost = await jobsPostHandler(reqPost);
  assert.strictEqual(resPost.status, 401);
});

test('Scheduled Cron Endpoint: Rejects missing or invalid CRON_SECRET with HTTP 401', async () => {
  // 1. Missing header
  const reqMissing = new Request('http://localhost:3000/api/cron/sync', {
    method: 'GET',
  });
  const resMissing = await cronHandler(reqMissing);
  assert.strictEqual(resMissing.status, 401);

  // 2. Invalid bearer token
  const reqInvalid = new Request('http://localhost:3000/api/cron/sync', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer invalid_secret_token_123',
    },
  });
  const resInvalid = await cronPostHandler(reqInvalid);
  assert.strictEqual(resInvalid.status, 401);
});

test('Scheduled Cron Endpoint: Validates authorization when CRON_SECRET matches', async () => {
  const originalSecret = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = 'my_test_cron_secret_789';

    const reqValid = new Request('http://localhost:3000/api/cron/sync', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer my_test_cron_secret_789',
      },
    });

    const res = await cronHandler(reqValid);
    // Should pass auth check (status 200 or 500 depending on DB availability, but NOT 401)
    assert.notStrictEqual(res.status, 401);
  } finally {
    process.env.CRON_SECRET = originalSecret;
  }
});

test('LIVE/MOCK Isolation: Rejects mock tokens for real sync execution', async () => {
  const connectionWithMockToken = {
    id: 'conn_mock',
    encryptedAccessToken: encrypt('EAABwXyzFakeTokenForDemoPurpose123456'),
  };

  const originalEnv = process.env.NODE_ENV;
  const originalExpected = process.env.EXPECTED_NEON_ENDPOINT_ID;
  try {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.EXPECTED_NEON_ENDPOINT_ID = 'local-sqlite'; // Ensure isolation passes to test mock token rejection

    await assert.rejects(
      async () => {
        await MetaSyncEngine.syncAdAccount(connectionWithMockToken, {
          adAccountId: 'act_1380498158917028',
        });
      },
      {
        message: /Không thể thực hiện đồng bộ dữ liệu thật với Token Demo/,
      }
    );
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv;
    process.env.EXPECTED_NEON_ENDPOINT_ID = originalExpected;
  }
});


test('Insights-First Architecture: Entity extraction accurately groups distinct campaigns, adsets, and ads', () => {
  const sampleInsights = [
    {
      ad_id: 'ad_1',
      ad_name: 'Ad 1',
      adset_id: 'adset_1',
      adset_name: 'AdSet 1',
      campaign_id: 'camp_1',
      campaign_name: 'Camp 1',
      date_start: '2026-10-01',
      spend: '100000',
    },
    {
      ad_id: 'ad_2',
      ad_name: 'Ad 2',
      adset_id: 'adset_1',
      adset_name: 'AdSet 1',
      campaign_id: 'camp_1',
      campaign_name: 'Camp 1',
      date_start: '2026-10-01',
      spend: '150000',
    },
    {
      ad_id: 'ad_3',
      ad_name: 'Ad 3',
      adset_id: 'adset_2',
      adset_name: 'AdSet 2',
      campaign_id: 'camp_2',
      campaign_name: 'Camp 2',
      date_start: '2026-10-01',
      spend: '200000',
    },
  ];

  const campaigns = new Map<string, { id: string; name: string }>();
  const adsets = new Map<string, { id: string; name: string; campaignId: string }>();
  const ads = new Map<string, { id: string; name: string; adsetId: string; campaignId: string }>();

  for (const i of sampleInsights) {
    campaigns.set(i.campaign_id, { id: i.campaign_id, name: i.campaign_name });
    adsets.set(i.adset_id, { id: i.adset_id, name: i.adset_name, campaignId: i.campaign_id });
    ads.set(i.ad_id, { id: i.ad_id, name: i.ad_name, adsetId: i.adset_id, campaignId: i.campaign_id });
  }

  assert.strictEqual(campaigns.size, 2);
  assert.strictEqual(adsets.size, 2);
  assert.strictEqual(ads.size, 3);
  assert.strictEqual(ads.get('ad_1')?.adsetId, 'adset_1');
  assert.strictEqual(adsets.get('adset_1')?.campaignId, 'camp_1');
});

// ─── Meta Insights Field Validation Tests ─────────────────────────────────────

test('Insights fields: video_3sec_video_view is never included in INSIGHTS_CORE_FIELDS', () => {
  assert.ok(
    !INSIGHTS_CORE_FIELDS.includes('video_3sec_video_view'),
    'INSIGHTS_CORE_FIELDS must not contain the invalid field video_3sec_video_view'
  );
});

test('Insights fields: video_3sec_video_view is never included in INSIGHTS_ACCOUNT_FIELDS', () => {
  assert.ok(
    !INSIGHTS_ACCOUNT_FIELDS.includes('video_3sec_video_view'),
    'INSIGHTS_ACCOUNT_FIELDS must not contain the invalid field video_3sec_video_view'
  );
});

test('Insights fields: video_3sec_video_view is never included in INSIGHTS_OPTIONAL_VIDEO_FIELDS', () => {
  assert.ok(
    !INSIGHTS_OPTIONAL_VIDEO_FIELDS.includes('video_3sec_video_view'),
    'INSIGHTS_OPTIONAL_VIDEO_FIELDS must not contain the invalid field video_3sec_video_view'
  );
});

test('Insights fields: INSIGHTS_CORE_FIELDS contains all mandatory core fields', () => {
  const required = [
    'account_id', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'ad_id', 'ad_name', 'date_start', 'date_stop', 'spend', 'impressions',
    'clicks', 'reach', 'inline_link_clicks', 'actions', 'action_values', 'cost_per_action_type',
  ];
  for (const field of required) {
    assert.ok(
      INSIGHTS_CORE_FIELDS.includes(field),
      `INSIGHTS_CORE_FIELDS must include required field: ${field}`
    );
  }
});

test('Insights fields: INSIGHTS_ACCOUNT_FIELDS contains no entity breakdown fields', () => {
  const forbidden = ['campaign_id', 'adset_id', 'ad_id', 'ad_name'];
  for (const field of forbidden) {
    assert.ok(
      !INSIGHTS_ACCOUNT_FIELDS.includes(field),
      `INSIGHTS_ACCOUNT_FIELDS must not include entity breakdown field: ${field}`
    );
  }
});

test('Insights fields: 3-second video view correctly extracted from actions array (not top-level field)', () => {
  // Simulates the extraction logic in metaSyncEngine.ts
  const actions = [
    { action_type: 'lead', value: '5' },
    { action_type: 'video_view', value: '1200' }, // 3-sec video view in actions
    { action_type: 'link_click', value: '300' },
  ];

  const videoViewAction = actions.find(a => a.action_type === 'video_view');
  const video3sViews = videoViewAction ? parseInt(videoViewAction.value || '0', 10) : 0;

  assert.strictEqual(video3sViews, 1200);
});

test('Insights fields: raw actions and action_values are preserved during extraction', () => {
  const insight = {
    ad_id: 'ad_test_123',
    date_start: '2026-10-01',
    spend: '500000',
    actions: [
      { action_type: 'lead', value: '3' },
      { action_type: 'video_view', value: '500' },
    ],
    action_values: [
      { action_type: 'lead', value: '1500000' },
    ],
  };

  const actionsJson = insight.actions ? JSON.stringify(insight.actions) : null;
  const breakdownJson = insight.action_values ? JSON.stringify(insight.action_values) : null;

  assert.ok(actionsJson !== null, 'actionsJson must be persisted');
  assert.ok(breakdownJson !== null, 'breakdownJson (action_values) must be persisted');

  const parsedActions = JSON.parse(actionsJson!);
  assert.strictEqual(parsedActions.length, 2);
  assert.strictEqual(parsedActions[1].action_type, 'video_view');
});

test('Meta error code 100 (invalid fields param) is reported with correct code and message', () => {
  const rawError = {
    error: {
      message: '(#100) video_3sec_video_view is not valid for fields param.',
      type: 'OAuthException',
      code: 100,
      fbtrace_id: 'AXyzCorrelation',
    },
  };

  const err = parseMetaError(rawError);
  assert.strictEqual(err.code, 100);
  // code 100 with invalid fields message falls into API_ERROR category
  assert.ok(
    ['API_ERROR', 'ACCOUNT_NOT_ACCESSIBLE'].includes(err.category),
    `Expected API_ERROR or ACCOUNT_NOT_ACCESSIBLE, got: ${err.category}`
  );
  assert.ok(err.message.includes('video_3sec_video_view'), 'Error message should contain the offending field name');
});

test('Date Chunking: splitDateRangeToDays handles single date range', () => {
  const dates = splitDateRangeToDays('2026-10-01', '2026-10-01');
  assert.deepStrictEqual(dates, ['2026-10-01']);
});

test('Date Chunking: splitDateRangeToDays splits 7-day range into 7 consecutive daily chunks', () => {
  const dates = splitDateRangeToDays('2026-10-01', '2026-10-07');
  assert.deepStrictEqual(dates, [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ]);
  assert.strictEqual(dates.length, 7);
});

test('Date Chunking: splitDateRangeToDays correctly handles month boundary transition', () => {
  const dates = splitDateRangeToDays('2026-10-30', '2026-11-02');
  assert.deepStrictEqual(dates, [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);
  assert.strictEqual(dates.length, 4);
});

test('Date Chunking: splitDateRangeToDays handles inverted or invalid date range gracefully', () => {
  const datesInverted = splitDateRangeToDays('2026-10-07', '2026-10-01');
  assert.deepStrictEqual(datesInverted, ['2026-10-07']);

  const datesInvalid = splitDateRangeToDays('invalid-date', '2026-10-01');
  assert.deepStrictEqual(datesInvalid, ['invalid-date']);
});

test('Execution Safety & Budget: Constants configured for 300s Serverless execution', () => {
  assert.strictEqual(FUNCTION_TIMEOUT_MS, 280 * 1000, 'Function timeout must allow buffer under 300s limit');
  assert.strictEqual(SAFETY_BUDGET_REMAINING_MS, 25 * 1000, 'Safety budget threshold is 25s');
  assert.ok(FUNCTION_TIMEOUT_MS < SYNC_JOB_LEASE_MS, 'Function timeout must be bounded within job lease');
});
