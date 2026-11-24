import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeNeonEndpointId,
  getDatabaseEndpointInfo,
  verifyDatabaseIsolation,
  assertDatabaseIsolation,
} from '../src/lib/sync/preflightGuard';
import { GET as preflightHandler } from '../src/app/api/system/preflight/route';
import { SINGLE_USER_PASSWORD } from '../src/lib/auth';

test('normalizeNeonEndpointId: Normalizes various endpoint shapes and pooler suffixes', () => {
  // Bare endpoint ID
  assert.strictEqual(normalizeNeonEndpointId('ep-summer-tree-123456'), 'ep-summer-tree-123456');

  // Pooled endpoint ID
  assert.strictEqual(normalizeNeonEndpointId('ep-summer-tree-123456-pooler'), 'ep-summer-tree-123456');

  // Full host with domain
  assert.strictEqual(
    normalizeNeonEndpointId('ep-summer-tree-123456-pooler.us-east-2.aws.neon.tech'),
    'ep-summer-tree-123456'
  );

  // Full PostgreSQL connection URI
  assert.strictEqual(
    normalizeNeonEndpointId(
      'postgresql://neon_user:my_secret_pw@ep-summer-tree-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
    ),
    'ep-summer-tree-123456'
  );

  // Handles null, undefined, whitespace, uppercase
  assert.strictEqual(normalizeNeonEndpointId('  EP-SUMMER-TREE-123456-POOLER  '), 'ep-summer-tree-123456');
  assert.strictEqual(normalizeNeonEndpointId(null), '');
  assert.strictEqual(normalizeNeonEndpointId(undefined), '');
});

test('verifyDatabaseIsolation: Returns PASS when actual matches expected Preview endpoint', () => {
  const previewUri =
    'postgresql://neon_admin:secret@ep-dewey-preview-777888-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

  const result = verifyDatabaseIsolation({
    databaseUrl: previewUri,
    expectedEndpointId: 'ep-dewey-preview-777888',
  });

  assert.strictEqual(result.status, 'PASS');
  assert.strictEqual(result.isIsolated, true);
  assert.strictEqual(result.actualEndpointId, 'ep-dewey-preview-777888');
  assert.strictEqual(result.expectedEndpointId, 'ep-dewey-preview-777888');

  // Also assert that assertDatabaseIsolation does not throw
  assert.doesNotThrow(() => {
    assertDatabaseIsolation({
      databaseUrl: previewUri,
      expectedEndpointId: 'ep-dewey-preview-777888-pooler',
    });
  });
});

test('verifyDatabaseIsolation: Returns FAIL on endpoint mismatch (Production protection)', () => {
  const productionUri =
    'postgresql://prod_admin:prod_secret@ep-dewey-production-111222-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

  const result = verifyDatabaseIsolation({
    databaseUrl: productionUri,
    expectedEndpointId: 'ep-dewey-preview-777888',
  });

  assert.strictEqual(result.status, 'FAIL');
  assert.strictEqual(result.isIsolated, false);
  assert.strictEqual(result.actualEndpointId, 'ep-dewey-production-111222');
  assert.strictEqual(result.expectedEndpointId, 'ep-dewey-preview-777888');
  assert.strictEqual(result.reason, 'ENDPOINT_MISMATCH');

  // Must fail closed and throw security error on write attempt
  assert.throws(
    () => {
      assertDatabaseIsolation({
        databaseUrl: productionUri,
        expectedEndpointId: 'ep-dewey-preview-777888',
      });
    },
    {
      message: /\[SECURITY WRITE GUARD BLOCKED\]/,
    }
  );
});

test('verifyDatabaseIsolation: Returns NOT_VERIFIED when expected endpoint ID is missing', () => {
  const remoteUri =
    'postgresql://user:pass@ep-some-random-333444-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

  const result = verifyDatabaseIsolation({
    databaseUrl: remoteUri,
    expectedEndpointId: '',
  });

  assert.strictEqual(result.status, 'NOT_VERIFIED');
  assert.strictEqual(result.isIsolated, false);
  assert.strictEqual(result.reason, 'MISSING_EXPECTED_ENDPOINT');
  assert.strictEqual(result.expectedEndpointId, null);

  // Must fail closed on write attempt when not verified
  assert.throws(
    () => {
      assertDatabaseIsolation({
        databaseUrl: remoteUri,
        expectedEndpointId: '',
      });
    },
    {
      message: /\[SECURITY WRITE GUARD BLOCKED\]/,
    }
  );
});

test('Secret Redaction: Database passwords and credentials never leak in endpoint info', () => {
  const sensitiveUri =
    'postgresql://sensitive_user:ultra_confidential_pass_12345!@ep-confidential-888999-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

  const info = getDatabaseEndpointInfo(sensitiveUri);

  // Assert credentials never appear in output properties
  const serialized = JSON.stringify(info);
  assert.ok(!serialized.includes('ultra_confidential_pass'));
  assert.ok(!serialized.includes('sensitive_user'));
  assert.ok(!serialized.includes('ultra_confidential'));

  assert.strictEqual(info.isNeon, true);
  assert.strictEqual(info.isPooled, true);
  assert.strictEqual(info.normalizedEndpointId, 'ep-confidential-888999');
  assert.strictEqual(info.databaseName, 'neondb');
});

test('getDatabaseEndpointInfo: Correctly classifies local file-based database', () => {
  const localUri = 'file:./dev.db';
  const info = getDatabaseEndpointInfo(localUri);

  assert.strictEqual(info.configured, true);
  assert.strictEqual(info.isLocal, true);
  assert.strictEqual(info.isNeon, false);
  assert.strictEqual(info.normalizedEndpointId, 'local-sqlite');
});

test('System Preflight API: Rejects unauthorized requests with HTTP 401', async () => {
  // Request without session cookies or authorization headers
  const req = new Request('http://localhost:3000/api/system/preflight', {
    method: 'GET',
  });

  const res = await preflightHandler(req);
  assert.strictEqual(res.status, 401);

  const body = await res.json();
  assert.ok(body.error.includes('Chưa đăng nhập'));
});

test('System Preflight API: Returns complete diagnostics structure for authorized requests', async () => {
  // Request with authorized Bearer header
  const req = new Request('http://localhost:3000/api/system/preflight', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${SINGLE_USER_PASSWORD}`,
    },
  });

  const res = await preflightHandler(req);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.environment);
  assert.ok(data.git);
  assert.ok(data.database);
  assert.ok(data.databaseIsolation);
  assert.ok(data.meta);
  assert.ok(data.task2Readiness);

  // Redaction check: ensure no passwords in response payload
  const payloadStr = JSON.stringify(data);
  assert.ok(!payloadStr.includes('password'));
  assert.ok(!payloadStr.includes('accessToken'));
  assert.ok(!payloadStr.includes('encryptedAccessToken'));
});
