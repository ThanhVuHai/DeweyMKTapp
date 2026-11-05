import test from 'node:test';
import assert from 'node:assert';
import {
  MetaApiService,
  MetaApiError,
  normalizeAdAccountId,
} from '../src/lib/meta';
import {
  MetaReadOnlySyncService,
  ReadOnlyInspectResult,
} from '../src/lib/sync/metaReadOnlyService';
import { encrypt } from '../src/lib/crypto';

test('MetaReadOnlySyncService: Ad Account info & token permissions inspection', async () => {
  const mockConnection = {
    id: 'conn_test_01',
    connectionName: 'Dewey Marketing Meta Connection',
    encryptedAccessToken: encrypt('test-token-demo'),
    graphApiVersion: 'v25.0',
  };

  const result: ReadOnlyInspectResult = await MetaReadOnlySyncService.inspectAdAccount(
    mockConnection,
    {
      adAccountId: 'act_2938472948',
      sampleLimit: 10,
      maxPages: 1,
    }
  );

  // 1. Ad Account Info verification
  assert.strictEqual(result.adAccount.accountId, 'act_2938472948');
  assert.strictEqual(result.adAccount.currency, 'VND');
  assert.strictEqual(result.adAccount.status, 'ACTIVE');

  // 2. Token permissions verification
  assert.strictEqual(result.tokenPermissions.valid, true);
  assert.strictEqual(result.tokenPermissions.hasAdsRead, true);
  assert.ok(result.tokenPermissions.permissions.includes('ads_read'));
  assert.strictEqual(result.tokenPermissions.userId, 'demo_user_123');
  assert.strictEqual(result.tokenPermissions.userName, 'Dewey Demo Manager');
});

test('MetaApiService: Bounded exponential retry recovers from transient rate limit errors', async () => {
  MetaApiService.mockRetryCounter = {};

  const connection = {
    accessToken: 'test-token-rate-limit',
  };

  const response = await MetaApiService.requestMetaAPIWithRetry<{ id: string; success: boolean }>(
    'act_123456/insights',
    connection,
    { limit: '25' },
    { maxRetries: 2, baseDelayMs: 10 }
  );

  // On attempt 0 it throws code 17 (rate limit), on attempt 1 it succeeds
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.id, 'recovered_after_retry');
  assert.strictEqual(MetaApiService.mockRetryCounter['act_123456/insights_25'], 2);
});

test('MetaApiService: Cursor-based pagination traverses multiple pages', async () => {
  const connection = {
    accessToken: 'test-token-pagination',
  };

  const pagedResult = await MetaApiService.getCampaignsPaged(
    'act_2938472948',
    connection,
    {
      limit: 1,
      maxPages: 2,
    }
  );

  // Assert both pages were traversed
  assert.strictEqual(pagedResult.pagesFetched, 2);
  assert.strictEqual(pagedResult.data.length, 2);
  assert.strictEqual(pagedResult.data[0].id, 'c_mock_p1_1');
  assert.strictEqual(pagedResult.data[1].id, 'c_mock_p2_1');
  assert.strictEqual(pagedResult.nextCursor, 'cursor_camp_p2');
});

test('MetaReadOnlySyncService: Validates parent-child relationships and detects orphans', async () => {
  const mockConnection = {
    id: 'conn_test_rel',
    connectionName: 'Dewey Rel Test',
    encryptedAccessToken: encrypt('test-token-relationships'),
    graphApiVersion: 'v25.0',
  };

  const result = await MetaReadOnlySyncService.inspectAdAccount(mockConnection, {
    adAccountId: 'act_99887766',
    sampleLimit: 10,
    maxPages: 2,
  });

  const rel = result.relationshipValidation;

  // Counts
  assert.strictEqual(rel.totalCampaigns, 2);
  assert.strictEqual(rel.totalAdSets, 3);
  assert.strictEqual(rel.totalAds, 4);

  // AdSet to Campaign
  assert.strictEqual(rel.validAdSetToCampaignCount, 2);
  assert.strictEqual(rel.orphanAdSetCount, 1);
  assert.strictEqual(rel.orphanAdSets[0].adsetId, 'as_orphan');
  assert.strictEqual(rel.orphanAdSets[0].campaignId, 'c_orphan_999');

  // Ad to AdSet & Campaign
  assert.strictEqual(rel.validAdToAdSetCount, 2);
  assert.strictEqual(rel.orphanAdCount, 2);
  const orphanAdSetRef = rel.orphanAds.find(o => o.adId === 'ad_orphan_adset');
  const orphanCampRef = rel.orphanAds.find(o => o.adId === 'ad_orphan_camp');
  assert.ok(orphanAdSetRef);
  assert.ok(orphanCampRef);
});

test('MetaReadOnlySyncService: Retrieves sample insights at campaign and ad levels', async () => {
  const mockConnection = {
    id: 'conn_test_insights',
    connectionName: 'Dewey Insights Test',
    encryptedAccessToken: encrypt('test-token-relationships'),
  };

  const result = await MetaReadOnlySyncService.inspectAdAccount(mockConnection, {
    adAccountId: 'act_99887766',
    dateFrom: '2026-05-15',
    dateTo: '2026-05-22',
  });

  assert.strictEqual(result.insights.campaignLevelCount, 2);
  assert.strictEqual(result.insights.adLevelCount, 2);
  assert.strictEqual(result.insights.dateRange?.dateFrom, '2026-05-15');
  assert.strictEqual(result.insights.dateRange?.dateTo, '2026-05-22');

  const camp1 = result.insights.campaignLevelSample[0];
  assert.strictEqual(camp1.campaign_id, 'c_rel_1');
  assert.strictEqual(camp1.spend, '2500000');

  const ad1 = result.insights.adLevelSample[0];
  assert.strictEqual(ad1.ad_id, 'ad_rel_1');
  assert.strictEqual(ad1.spend, '1500000');
});

test('MetaApiError: Categorized error handling for expired tokens and missing permissions', async () => {
  // 1. Expired Token
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccounts({ accessToken: 'test-token-expired' });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'TOKEN_EXPIRED');
      assert.strictEqual(err.code, 190);
      assert.strictEqual(err.subcode, 463);
      assert.ok(err.userMessage.includes('hết hạn hoặc không hợp lệ'));
      return true;
    }
  );

  // 2. Missing ads_read
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccounts({ accessToken: 'test-token-no-ads-read' });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'MISSING_ADS_READ');
      assert.strictEqual(err.code, 200);
      assert.ok(err.userMessage.includes('ads_read'));
      return true;
    }
  );

  // 3. Inaccessible Ad Account
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccount('act_123456789', {
        accessToken: 'test-token-no-account',
      });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'ACCOUNT_NOT_ACCESSIBLE');
      assert.strictEqual(err.code, 100);
      assert.ok(err.userMessage.includes('act_xxxxxxxx'));
      return true;
    }
  );
});

test('Zero Mutation & Security: Token sanitization assertion', async () => {
  const secretPlainToken = 'test-token-relationships';
  const mockConnection = {
    id: 'conn_sec_test',
    connectionName: 'Dewey Security Test',
    encryptedAccessToken: encrypt(secretPlainToken),
  };

  const result = await MetaReadOnlySyncService.inspectAdAccount(mockConnection, {
    adAccountId: 'act_99887766',
  });

  const serialized = JSON.stringify(result);

  // Token must NEVER be leaked in inspection output
  assert.strictEqual(serialized.includes(secretPlainToken), false);
  assert.strictEqual(serialized.includes('access_token'), false);
  assert.strictEqual(serialized.includes('encryptedAccessToken'), false);

  // Normalization check
  assert.strictEqual(normalizeAdAccountId('99887766'), 'act_99887766');
});
