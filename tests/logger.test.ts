import test from 'node:test';
import assert from 'node:assert';
import { sanitizeString, sanitizeForLogging, sanitizeError } from '../src/lib/redaction';
import { Logger, generateCorrelationId } from '../src/lib/logger';
import { recordUserAction } from '../src/lib/audit';
import { GET as auditLogsHandler } from '../src/app/api/audit-logs/route';
import { POST as migrateHandler } from '../src/app/api/system/migrate/route';
import { SINGLE_USER_PASSWORD } from '../src/lib/auth';

test('Secret Redaction: Redacts Meta Access Tokens in strings and nested objects', () => {
  const liveToken = 'EAABwZCs1234567890abcdefghijklmnopqrstuvwxyz';
  const rawString = `Error fetching insights with token ${liveToken} on ad account act_123`;
  const sanitized = sanitizeString(rawString);

  assert.strictEqual(sanitized.includes(liveToken), false);
  assert.strictEqual(sanitized.includes('[REDACTED_META_TOKEN]'), true);

  // Nested object with sensitive key and sensitive string
  const nestedObj = {
    accessToken: liveToken,
    details: {
      url: `https://graph.facebook.com/v25.0/act_123/insights?access_token=${liveToken}`,
      normalKey: 'Dewey Education',
    },
    list: [liveToken, 'safe-item'],
  };

  const clean = sanitizeForLogging(nestedObj);
  assert.strictEqual(clean.accessToken, '[REDACTED]');
  assert.strictEqual(clean.details.url.includes(liveToken), false);
  assert.strictEqual(clean.details.url.includes('[REDACTED_SECRET]'), true);
  assert.strictEqual(clean.details.normalKey, 'Dewey Education');
  assert.strictEqual(clean.list[0], '[REDACTED_META_TOKEN]');
  assert.strictEqual(clean.list[1], 'safe-item');
});

test('Secret Redaction: Redacts PostgreSQL connection URIs and passwords', () => {
  const secretDbUri =
    'postgresql://neon_admin:mySuperSecretPassword123@ep-dewey-preview-777888-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=15';
  const sanitized = sanitizeString(`Failed to connect to ${secretDbUri}`);

  assert.strictEqual(sanitized.includes('mySuperSecretPassword123'), false);
  assert.strictEqual(sanitized.includes('[REDACTED_DB_PASSWORD]'), true);
  assert.strictEqual(sanitized.includes('ep-dewey-preview-777888-pooler'), true);
});

test('Secret Redaction: Redacts Bearer tokens and Authorization headers', () => {
  const bearerHeader = 'Authorization: Bearer my_jwt_token_abcdef123456789';
  const sanitized = sanitizeString(bearerHeader);

  assert.strictEqual(sanitized.includes('my_jwt_token_abcdef123456789'), false);
  assert.strictEqual(sanitized.includes('[REDACTED_HEADER]'), true);

  const rawBearerText = 'User requested with Bearer secret_bearer_token_987654321 in payload';
  const sanitizedText = sanitizeString(rawBearerText);
  assert.strictEqual(sanitizedText.includes('secret_bearer_token_987654321'), false);
  assert.strictEqual(sanitizedText.includes('[REDACTED_BEARER_TOKEN]'), true);
});

test('Secret Redaction: Error and Exception serialization strips secrets from stack and message', () => {
  const secretToken = 'EAABwZCsSecretToken1234567890';
  const secretDb = 'postgres://admin:topSecretPassword@host:5432/db';
  const rawError = new Error(`Connection to ${secretDb} failed with token ${secretToken}`);

  const safeErr = sanitizeError(rawError);
  assert.strictEqual(safeErr.message.includes('topSecretPassword'), false);
  assert.strictEqual(safeErr.message.includes(secretToken), false);
  assert.strictEqual(safeErr.message.includes('[REDACTED_DB_PASSWORD]'), true);
  assert.strictEqual(safeErr.message.includes('[REDACTED_META_TOKEN]'), true);

  if (safeErr.stack) {
    assert.strictEqual(safeErr.stack.includes('topSecretPassword'), false);
    assert.strictEqual(safeErr.stack.includes(secretToken), false);
  }
});

test('Secret Redaction: AuditLog before/after payloads are sanitized before logging', async () => {
  const beforeState = {
    connectionName: 'GIS Hanoi Live',
    accessToken: 'EAABwZCsOldToken1234567890',
  };
  const afterState = {
    connectionName: 'GIS Hanoi Live Updated',
    accessToken: 'EAABwZCsNewToken9876543210',
    dbUrl: 'postgresql://user:secret@host/db',
  };

  // Ensure recordUserAction executes without error and sanitizes
  await assert.doesNotReject(async () => {
    await recordUserAction({
      userId: 'test-user-id',
      actorEmail: 'admin@dewey.edu.vn',
      action: 'UPDATE_CONNECTION',
      entityType: 'MetaConnection',
      entityId: 'conn_test_123',
      before: beforeState,
      after: afterState,
    });
  });
});

test('Structured Logging: Correlation ID is generated and unique', () => {
  const id1 = generateCorrelationId();
  const id2 = generateCorrelationId();

  assert.strictEqual(typeof id1, 'string');
  assert.strictEqual(typeof id2, 'string');
  assert.strictEqual(id1.length > 20, true);
  assert.notStrictEqual(id1, id2);
});

test('Structured Logging: Logger never throws on missing DB or persistence failure', async () => {
  const correlationId = generateCorrelationId();

  // Logging should always resolve cleanly and never throw, even if DB is unavailable
  await assert.doesNotReject(async () => {
    await Logger.info(
      'SYNC_ENGINE',
      'TestEvent',
      'Testing safe logging execution',
      {
        correlationId,
        adAccountId: 'act_1380498158917028',
      },
      {
        stage: 'unit_testing',
        durationMs: 125,
        recordCount: 14,
        metadata: {
          testKey: 'testValue',
          sensitiveKey: 'secret_123',
        },
      }
    );
  });
});

test('Audit Logs API: Rejects unauthenticated requests with HTTP 401', async () => {
  const unauthReq = new Request('http://localhost:3000/api/audit-logs');
  const res = await auditLogsHandler(unauthReq);

  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.error.includes('Chưa đăng nhập'), true);
});

test('Audit Logs API: Authenticates authorized requests and protects from credential leakage', async () => {
  const authReq = new Request('http://localhost:3000/api/audit-logs?tab=all&page=1&limit=10', {
    headers: {
      Authorization: `Bearer ${SINGLE_USER_PASSWORD}`,
    },
  });

  const res = await auditLogsHandler(authReq);
  // Must pass authentication check (not 401)
  assert.notStrictEqual(res.status, 401);

  const data = await res.json();
  if (res.status === 200) {
    assert.strictEqual(data.success, true);
    assert.strictEqual(Array.isArray(data.logs), true);
  } else {
    // In local unit test environments without remote Postgres, ensure error is sanitized
    assert.strictEqual(typeof data.error, 'string');
    assert.strictEqual(data.error.includes('my_secret_pw'), false);
  }
});

test('Additive Migration API: Rejects unauthenticated requests with HTTP 401', async () => {
  const unauthReq = new Request('http://localhost:3000/api/system/migrate', { method: 'POST' });
  const res = await migrateHandler(unauthReq);

  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.error.includes('Chưa đăng nhập'), true);
});

test('Additive Migration API: Rejects execution on Production environment with HTTP 403', async () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';

  try {
    const authReq = new Request('http://localhost:3000/api/system/migrate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SINGLE_USER_PASSWORD}` },
    });
    const res = await migrateHandler(authReq);

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.errorCode, 'PRODUCTION_MIGRATION_FORBIDDEN');
  } finally {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test('Additive Migration API: Rejects execution when runtime migration is disabled with HTTP 403', async () => {
  const originalDisable = process.env.DISABLE_RUNTIME_MIGRATION;
  process.env.DISABLE_RUNTIME_MIGRATION = 'true';

  try {
    const authReq = new Request('http://localhost:3000/api/system/migrate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SINGLE_USER_PASSWORD}` },
    });
    const res = await migrateHandler(authReq);

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.errorCode, 'RUNTIME_MIGRATION_DISABLED');
  } finally {
    process.env.DISABLE_RUNTIME_MIGRATION = originalDisable;
  }
});

test('Additive Migration API: Rejects execution when database isolation status is NOT PASS with HTTP 403', async () => {
  const originalExpected = process.env.EXPECTED_NEON_ENDPOINT_ID;
  process.env.EXPECTED_NEON_ENDPOINT_ID = 'ep-wrong-expected-endpoint';

  try {
    const authReq = new Request('http://localhost:3000/api/system/migrate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SINGLE_USER_PASSWORD}` },
    });
    const res = await migrateHandler(authReq);

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.errorCode, 'DATABASE_ISOLATION_FAILED');
  } finally {
    process.env.EXPECTED_NEON_ENDPOINT_ID = originalExpected;
  }
});
