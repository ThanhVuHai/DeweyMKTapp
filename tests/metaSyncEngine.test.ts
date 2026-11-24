import test from 'node:test';
import assert from 'node:assert';
import {
  MetaSyncEngine,
  ENABLED_ACCOUNTS_FOR_SYNC,
} from '../src/lib/sync/metaSyncEngine';
import { encrypt } from '../src/lib/crypto';
import { GET as cronHandler, POST as cronPostHandler } from '../src/app/api/cron/sync/route';

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
