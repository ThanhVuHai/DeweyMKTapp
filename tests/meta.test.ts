import test from 'node:test';
import assert from 'node:assert';
import {
  MetaApiService,
  MetaApiError,
  normalizeAdAccountId,
  parseMetaError,
} from '../src/lib/meta';
import { maskToken } from '../src/lib/crypto';

test('normalizeAdAccountId utility', () => {
  // Test numeric string gets act_ prefix
  assert.strictEqual(normalizeAdAccountId('2938472948'), 'act_2938472948');

  // Test already prefixed string stays identical
  assert.strictEqual(normalizeAdAccountId('act_2938472948'), 'act_2938472948');

  // Test whitespace trimming
  assert.strictEqual(normalizeAdAccountId('  act_99887766  '), 'act_99887766');
  assert.strictEqual(normalizeAdAccountId('  12345678  '), 'act_12345678');

  // Test empty string fallback
  assert.strictEqual(normalizeAdAccountId(''), '');
});

test('parseMetaError: converts Graph API errors to actionable Vietnamese guidance', () => {
  // 1. Token Expired (code 190 / subcode 463)
  const expiredErr = parseMetaError({
    error: {
      message: 'Error validating access token: Session has expired on Monday, 15-Jun-26 05:00:00 PDT.',
      type: 'OAuthException',
      code: 190,
      error_subcode: 463,
    },
  });
  assert.strictEqual(expiredErr.category, 'TOKEN_EXPIRED');
  assert.ok(expiredErr.userMessage.includes('hết hạn hoặc không hợp lệ'));

  // 2. Requires business_management (code 100) - The exact bug reported by user
  const bmErr = parseMetaError({
    error: {
      message: '(#100) Requires business_management permission to access the field.',
      type: 'OAuthException',
      code: 100,
    },
  });
  assert.strictEqual(bmErr.category, 'MISSING_BUSINESS_MANAGEMENT');
  assert.ok(bmErr.userMessage.includes('business_management'));
  assert.ok(bmErr.userMessage.includes('ads_read'));

  // 3. Missing ads_read permission (code 200)
  const adsReadErr = parseMetaError({
    error: {
      message: 'Requires ads_read permission to view this ad account data',
      type: 'OAuthException',
      code: 200,
    },
  });
  assert.strictEqual(adsReadErr.category, 'MISSING_ADS_READ');
  assert.ok(adsReadErr.userMessage.includes('ads_read'));

  // 4. Object does not exist / Account not accessible (code 100 / Unsupported get request)
  const notFoundErr = parseMetaError({
    error: {
      message: "Unsupported get request. Object with ID 'act_999999999' does not exist, cannot be loaded due to missing permissions",
      type: 'OAuthException',
      code: 100,
    },
  });
  assert.strictEqual(notFoundErr.category, 'ACCOUNT_NOT_ACCESSIBLE');
  assert.ok(notFoundErr.userMessage.includes('không có quyền truy cập Ad Account này'));

  // 5. Rate limit (code 17)
  const rateLimitErr = parseMetaError({
    error: {
      message: 'User request limit reached',
      type: 'OAuthException',
      code: 17,
    },
  });
  assert.strictEqual(rateLimitErr.category, 'RATE_LIMIT');
  assert.ok(rateLimitErr.userMessage.includes('Rate Limit'));
});

test('maskToken: securely conceals token value without leaking secret payload', () => {
  // Test masking normal token
  const masked = maskToken('EAABwXyzFakeTokenForDemoPurpose123456');
  assert.strictEqual(masked, 'EAAB************456');
  assert.ok(!masked.includes('FakeTokenForDemoPurpose'));

  // Short tokens
  assert.strictEqual(maskToken('short'), '********');
  assert.strictEqual(maskToken(''), '');
});

test('MetaApiService.getAdAccounts: uses only ads_read and successfully fetches accounts without business field', async () => {
  const accounts = await MetaApiService.getAdAccounts({
    encryptedAccessToken: 'mock-token',
    graphApiVersion: 'v25.0',
  });

  assert.ok(Array.isArray(accounts));
  assert.ok(accounts.length > 0);
  assert.strictEqual(accounts[0].accountId, 'act_2938472948');
  assert.strictEqual(accounts[0].accountName, 'Dewey School Global Campaigns');
  assert.strictEqual(accounts[0].currency, 'VND');
  assert.strictEqual(accounts[0].status, 'ACTIVE');
  // businessId is safely omitted in basic account sync to prevent permission errors
  assert.strictEqual(accounts[0].businessId, undefined);
});

test('MetaApiService.getAdAccount: allows manual account lookup by ID with ads_read', async () => {
  const account = await MetaApiService.getAdAccount('act_2938472948', {
    encryptedAccessToken: 'mock-token',
    graphApiVersion: 'v25.0',
  });

  assert.strictEqual(account.accountId, 'act_2938472948');
  assert.strictEqual(account.status, 'ACTIVE');
  assert.strictEqual(account.currency, 'VND');
});

test('MetaApiService.getBusinessInfo: safely returns null when token lacks business_management', async () => {
  // Testing with token lacking business_management
  const bm = await MetaApiService.getBusinessInfo('act_2938472948', {
    encryptedAccessToken: 'test-token-missing-bm',
    graphApiVersion: 'v25.0',
  });

  // Must not throw an unhandled exception, should return null gracefully
  assert.strictEqual(bm, null);
});

test('MetaApiService: throws categorized error when token is expired (code 190)', async () => {
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccounts({
        encryptedAccessToken: 'test-token-expired',
      });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'TOKEN_EXPIRED');
      assert.ok(err.userMessage.includes('hết hạn'));
      return true;
    }
  );
});

test('MetaApiService: throws categorized error when token lacks ads_read permission', async () => {
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccounts({
        encryptedAccessToken: 'test-token-no-ads-read',
      });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'MISSING_ADS_READ');
      assert.ok(err.userMessage.includes('ads_read'));
      return true;
    }
  );
});

test('MetaApiService: throws categorized error when Ad Account is not accessible / not granted', async () => {
  await assert.rejects(
    async () => {
      await MetaApiService.getAdAccount('act_999999999', {
        encryptedAccessToken: 'test-token-no-account',
      });
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'ACCOUNT_NOT_ACCESSIBLE');
      assert.ok(err.userMessage.includes('không có quyền truy cập'));
      return true;
    }
  );
});

test('MetaApiService.getTokenPermissions: inspects granted permissions and ads_read', async () => {
  const tokenInfo = await MetaApiService.getTokenPermissions({
    encryptedAccessToken: 'mock-token',
  });

  assert.strictEqual(tokenInfo.valid, true);
  assert.strictEqual(tokenInfo.hasAdsRead, true);
  assert.ok(tokenInfo.permissions.includes('ads_read'));
});

