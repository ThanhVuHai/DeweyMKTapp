import test from 'node:test';
import assert from 'node:assert';
import {
  MetaApiService,
  MetaApiError,
  normalizeAdAccountId,
  parseMetaError,
  classifyMetaError,
  calculateBackoffWithJitter,
  extractRateLimitHeaders,
  RequestRecoveredContext,
  RequestExhaustedContext,
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

// =========================================================================
// Task 2.3: Error-Aware Retry Policy & Jittered Backoff Tests
// =========================================================================

test('Task 2.3: classifyMetaError correctly categorizes error classes', () => {
  // 1. Permanent non-retryable errors
  const errTokenExpired = new MetaApiError('Token expired', { code: 190, category: 'TOKEN_EXPIRED' });
  assert.strictEqual(classifyMetaError(errTokenExpired), 'PERMANENT');

  const errMissingAdsRead = new MetaApiError('Missing ads_read', { code: 200, category: 'MISSING_ADS_READ' });
  assert.strictEqual(classifyMetaError(errMissingAdsRead), 'PERMANENT');

  const errMissingBm = new MetaApiError('Missing business_management', { code: 100, category: 'MISSING_BUSINESS_MANAGEMENT' });
  assert.strictEqual(classifyMetaError(errMissingBm), 'PERMANENT');

  const errAccountNotAccessible = new MetaApiError('Account not accessible', { code: 100, category: 'ACCOUNT_NOT_ACCESSIBLE' });
  assert.strictEqual(classifyMetaError(errAccountNotAccessible), 'PERMANENT');

  // 2. Meta Error 2: Service temporarily unavailable
  const errMeta2 = new MetaApiError('Service temporarily unavailable', { code: 2 });
  assert.strictEqual(classifyMetaError(errMeta2), 'META_ERROR_2');

  const errMetaSubcode = new MetaApiError('Temporary glitch', { subcode: 1357045 });
  assert.strictEqual(classifyMetaError(errMetaSubcode), 'META_ERROR_2');

  // 3. Rate Limit
  const errRateLimit17 = new MetaApiError('User request limit reached', { code: 17 });
  assert.strictEqual(classifyMetaError(errRateLimit17), 'RATE_LIMIT');

  const errRateLimit80000 = new MetaApiError('Too many calls', { code: 80000 });
  assert.strictEqual(classifyMetaError(errRateLimit80000), 'RATE_LIMIT');

  const errRateLimit429 = new MetaApiError('Too Many Requests', { httpStatus: 429 });
  assert.strictEqual(classifyMetaError(errRateLimit429, 429), 'RATE_LIMIT');

  // 4. HTTP 5xx Server Errors
  const err500 = new MetaApiError('Internal Server Error', { httpStatus: 500 });
  assert.strictEqual(classifyMetaError(err500), 'SERVER_ERROR_5XX');

  const err502 = new MetaApiError('Bad Gateway', { httpStatus: 502 });
  assert.strictEqual(classifyMetaError(err502, 502), 'SERVER_ERROR_5XX');

  const err503 = new MetaApiError('Service Unavailable', { httpStatus: 503 });
  assert.strictEqual(classifyMetaError(err503, 503), 'SERVER_ERROR_5XX');

  // 5. Network / Timeout
  const errNetwork = new MetaApiError('Connection reset', { category: 'NETWORK_ERROR' });
  assert.strictEqual(classifyMetaError(errNetwork), 'NETWORK_TIMEOUT');

  const rawAbort = new Error('The user aborted a request.');
  rawAbort.name = 'AbortError';
  assert.strictEqual(classifyMetaError(rawAbort), 'NETWORK_TIMEOUT');

  const rawConnReset = new Error('read ECONNRESET');
  assert.strictEqual(classifyMetaError(rawConnReset), 'NETWORK_TIMEOUT');

  const rawTimeout = new Error('connect ETIMEDOUT');
  assert.strictEqual(classifyMetaError(rawTimeout), 'NETWORK_TIMEOUT');
});

test('Task 2.3: calculateBackoffWithJitter bounds delay and respects minDelayMs', () => {
  // Base delay <= 0 returns 0
  assert.strictEqual(calculateBackoffWithJitter(0, 1, 10000), 0);

  // Attempt 1 with base 5000, max 30000: delay must be within [0, 5000]
  for (let i = 0; i < 20; i++) {
    const delay = calculateBackoffWithJitter(5000, 1, 30000);
    assert.ok(delay >= 0 && delay <= 5000, `Delay ${delay} should be between 0 and 5000`);
  }

  // Attempt 2 with base 5000, factor 2, max 30000: exponential is 10000, jitter in [0, 10000]
  for (let i = 0; i < 20; i++) {
    const delay = calculateBackoffWithJitter(5000, 2, 30000);
    assert.ok(delay >= 0 && delay <= 10000, `Delay ${delay} should be between 0 and 10000`);
  }

  // With server-specified minDelayMs (e.g. Retry-After = 8000ms):
  // Delay must never be lower than minDelayMs!
  for (let i = 0; i < 20; i++) {
    const delay = calculateBackoffWithJitter(5000, 2, 30000, 2, 8000);
    assert.ok(delay >= 8000, `Delay ${delay} must respect minDelayMs 8000`);
    assert.ok(delay <= 10000, `Delay ${delay} must not exceed bounded max 10000`);
  }

  // Bounded by maxDelayMs: attempt 10 with max 15000ms
  for (let i = 0; i < 20; i++) {
    const delay = calculateBackoffWithJitter(2000, 10, 15000);
    assert.ok(delay >= 0 && delay <= 15000, `Delay ${delay} should not exceed max 15000`);
  }
});

test('Task 2.3: extractRateLimitHeaders parses Retry-After and usage headers', () => {
  // 1. Retry-After header
  const headers1 = { 'retry-after': '45' };
  const meta1 = extractRateLimitHeaders(headers1);
  assert.ok(meta1);
  assert.strictEqual(meta1?.retryAfterSeconds, 45);

  // 2. x-business-use-case-usage header
  const usagePayload = JSON.stringify({
    'act_1380498158917028': [
      {
        type: 'ads_insights',
        call_count: 85,
        total_time: 78,
        total_cpu_time: 60,
        estimated_time_to_regain_access: 5, // 5 minutes
      },
    ],
  });
  const headers2 = { 'x-business-use-case-usage': usagePayload };
  const meta2 = extractRateLimitHeaders(headers2);
  assert.ok(meta2);
  assert.strictEqual(meta2?.callCount, 85);
  assert.strictEqual(meta2?.totalTime, 78);
  assert.strictEqual(meta2?.totalCpuTime, 60);
  assert.strictEqual(meta2?.estimatedTimeToRegainAccess, 300); // 5 mins -> 300s
  assert.strictEqual(meta2?.rawUsageHeader, usagePayload);

  // 3. x-app-usage header
  const appUsagePayload = JSON.stringify({
    call_count: 90,
    total_time: 80,
    total_cpu_time: 70,
  });
  const headers3 = { 'x-app-usage': appUsagePayload };
  const meta3 = extractRateLimitHeaders(headers3);
  assert.ok(meta3);
  assert.strictEqual(meta3?.callCount, 90);
  assert.strictEqual(meta3?.totalTime, 80);
  assert.strictEqual(meta3?.totalCpuTime, 70);

  // 4. Undefined / empty headers
  assert.strictEqual(extractRateLimitHeaders(undefined), undefined);
  assert.strictEqual(extractRateLimitHeaders({}), undefined);
});

test('Task 2.3: requestMetaAPIWithRetry recovers on Meta Error 2 and triggers onRecovered', async () => {
  MetaApiService.resetMockRetryCounter();

  let retryCount = 0;
  let recoveredContext: RequestRecoveredContext | null = null;
  let lastRetryClassification = '';

  const result = await MetaApiService.requestMetaAPIWithRetry(
    'test_endpoint',
    { accessToken: 'test-token-error-2' },
    {},
    {
      policies: {
        META_ERROR_2: {
          baseDelayMs: 10, // Short delay for fast test
          maxDelayMs: 50,
          maxAttempts: 3,
          backoffFactor: 2,
          jitter: true,
        },
      },
      onRetry: (attempt, err, delayMs, ctx) => {
        retryCount++;
        lastRetryClassification = ctx?.classification || '';
      },
      onRecovered: (ctx) => {
        recoveredContext = ctx;
      },
    }
  );

  assert.deepStrictEqual(result, { id: 'recovered_error_2', success: true });
  assert.strictEqual(retryCount, 1);
  assert.strictEqual(lastRetryClassification, 'META_ERROR_2');
  assert.ok(recoveredContext);
  assert.strictEqual((recoveredContext as RequestRecoveredContext).attempt, 1);
  assert.strictEqual((recoveredContext as RequestRecoveredContext).classification, 'META_ERROR_2');
});

test('Task 2.3: requestMetaAPIWithRetry throws immediately with 0 retries on permanent errors', async () => {
  let retryCount = 0;

  await assert.rejects(
    async () => {
      await MetaApiService.requestMetaAPIWithRetry(
        'test_endpoint',
        { accessToken: 'test-token-expired' },
        {},
        {
          onRetry: () => {
            retryCount++;
          },
        }
      );
    },
    (err: MetaApiError) => {
      assert.strictEqual(err.category, 'TOKEN_EXPIRED');
      assert.strictEqual(err.code, 190);
      return true;
    }
  );

  // Permanent error must NOT trigger any retry attempts!
  assert.strictEqual(retryCount, 0);
});

test('Task 2.3: requestMetaAPIWithRetry aborts safely when serverless execution budget is low', async () => {
  MetaApiService.resetMockRetryCounter();

  let exhaustedContext: RequestExhaustedContext | null = null;

  await assert.rejects(
    async () => {
      await MetaApiService.requestMetaAPIWithRetry(
        'test_endpoint',
        { accessToken: 'test-token-error-2' },
        {},
        {
          policies: {
            META_ERROR_2: {
              baseDelayMs: 5000,
              maxDelayMs: 15000,
              maxAttempts: 3,
              backoffFactor: 2,
              jitter: false,
            },
          },
          // Execution budget is only 2s, but delay + 10s persistence buffer requires >= 15s!
          remainingBudgetMs: () => 2000,
          onExhausted: (ctx) => {
            exhaustedContext = ctx;
          },
        }
      );
    },
    (err: MetaApiError) => {
      assert.ok(err.userMessage.includes('Quỹ thời gian thực thi Serverless sắp hết'));
      return true;
    }
  );

  assert.ok(exhaustedContext);
  assert.strictEqual((exhaustedContext as RequestExhaustedContext).classification, 'META_ERROR_2');
});

test('Task 2.3: requestMetaAPIWithRetry enforces per-chunk retry budget (maxRetryBudgetMs)', async () => {
  MetaApiService.resetMockRetryCounter();

  let exhaustedContext: RequestExhaustedContext | null = null;

  await assert.rejects(
    async () => {
      await MetaApiService.requestMetaAPIWithRetry(
        'test_endpoint',
        { accessToken: 'test-token-error-2-always' },
        {},
        {
          policies: {
            META_ERROR_2: {
              baseDelayMs: 100,
              maxDelayMs: 200,
              maxAttempts: 5,
              backoffFactor: 1,
              jitter: false,
            },
          },
          // Per-chunk retry budget is limited to 50ms, so calculated delay 100ms triggers budget exceeded!
          maxRetryBudgetMs: 50,
          onExhausted: (ctx) => {
            exhaustedContext = ctx;
          },
        }
      );
    },
    (err: MetaApiError) => {
      assert.ok(err.userMessage.includes('Đã vượt quá giới hạn thời gian thử lại tối đa cho ngày này'));
      return true;
    }
  );

  assert.ok(exhaustedContext);
  assert.strictEqual((exhaustedContext as RequestExhaustedContext).classification, 'META_ERROR_2');
});

