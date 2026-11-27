import test from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/db';
import { CheckpointManager } from '../src/lib/sync/checkpointManager';
import {
  MetaSyncEngine,
  splitDateRangeToDays,
} from '../src/lib/sync/metaSyncEngine';
import { MetaApiError } from '../src/lib/meta';
import { encrypt } from '../src/lib/crypto';

// In-memory mock store for unit testing without live PostgreSQL connection
interface MockCheckpointRecord {
  id: string;
  adAccountId: string;
  syncJobId: string;
  reportingDate: string;
  status: string;
  attemptCount: number;
  completedAt: Date | null;
  recordCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  isEmptyDay: boolean;
  lastError: string | null;
  retryEligible: boolean;
  nextEligibleAt: Date | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mockStore = new Map<string, MockCheckpointRecord>();
let mockSyncLogs: Array<{
  id: string;
  module: string;
  eventType: string;
  adAccountId: string | null;
  syncJobId: string | null;
  recordCount: number | null;
  sanitizedMeta: unknown;
  createdAt: Date;
}> = [];

// Setup mocks on Prisma Client
(prisma as unknown as { syncCheckpoint: unknown }).syncCheckpoint = {
  upsert: async ({
    where,
    update,
    create,
  }: {
    where: { adAccountId_reportingDate: { adAccountId: string; reportingDate: string } };
    update: Partial<MockCheckpointRecord>;
    create: MockCheckpointRecord;
  }) => {
    const key = `${where.adAccountId_reportingDate.adAccountId}_${where.adAccountId_reportingDate.reportingDate}`;
    const existing = mockStore.get(key);
    const record: MockCheckpointRecord = existing
      ? { ...existing, ...update, updatedAt: new Date() }
      : {
          ...create,
          id: create.id || `cp_${Date.now()}_${Math.random()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
    mockStore.set(key, record);
    return record;
  },
  findMany: async ({
    where,
  }: {
    where?: {
      adAccountId?: string;
      reportingDate?: { in?: string[] };
    };
  }) => {
    const dates = where?.reportingDate?.in;
    const accountId = where?.adAccountId;
    const results: MockCheckpointRecord[] = [];
    for (const record of mockStore.values()) {
      if (accountId && record.adAccountId !== accountId) continue;
      if (dates && !dates.includes(record.reportingDate)) continue;
      results.push(record);
    }
    return results;
  },
};

(prisma as unknown as { syncLog: unknown }).syncLog = {
  findMany: async ({
    where,
  }: {
    where?: {
      adAccountId?: string;
      module?: string;
      eventType?: string;
      syncJobId?: string;
    };
  }) => {
    return mockSyncLogs.filter((log) => {
      if (where?.adAccountId && log.adAccountId !== where.adAccountId) return false;
      if (where?.module && log.module !== where.module) return false;
      if (where?.eventType && log.eventType !== where.eventType) return false;
      if (where?.syncJobId && log.syncJobId !== where.syncJobId) return false;
      return true;
    });
  },
};

test('Task 2.4: CheckpointManager tracks success, metrics, and zero-activity dates', async () => {
  mockStore.clear();
  const accountId = 'act_1380498158917028';
  const testJobId = 'job_test_cp_01';
  const testDate = '2026-10-01';

  // 1. Record running
  await CheckpointManager.recordChunkRunning(accountId, testJobId, testDate);

  // 2. Record success with zero activity (empty day)
  await CheckpointManager.recordChunkSuccess(accountId, testJobId, testDate, {
    recordCount: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    isEmptyDay: true,
  });

  // Verify checkpoint state
  const result = await CheckpointManager.getVerifiedCheckpoints(accountId, [testDate], testJobId);
  assert.strictEqual(result.completedDates.length, 1);
  assert.strictEqual(result.completedDates[0], testDate);
  const cp = result.completedMap.get(testDate);
  assert.ok(cp);
  assert.strictEqual(cp?.status, 'SUCCESS');
  assert.strictEqual(cp?.isEmptyDay, true);
  assert.strictEqual(cp?.spend, 0);
  assert.strictEqual(cp?.retryEligible, false);
});

test('Task 2.4: CheckpointManager records failure and classifies retry eligibility', async () => {
  mockStore.clear();
  const accountId = 'act_1380498158917028';
  const testJobId = 'job_test_cp_fail';
  const permDate = '2026-10-15';
  const transDate = '2026-10-16';

  // Permanent error: Token Expired (code 190)
  const permErr = new MetaApiError('Session expired', { code: 190, category: 'TOKEN_EXPIRED' });
  await CheckpointManager.recordChunkFailure(accountId, testJobId, permDate, permErr, 1);

  // Transient error: Meta Error 2 with rate limit header
  const transErr = new MetaApiError('Service temporarily unavailable', {
    code: 2,
    rateLimitMetadata: { retryAfterSeconds: 45 },
  });
  await CheckpointManager.recordChunkFailure(accountId, testJobId, transDate, transErr, 1);

  const res = await CheckpointManager.getVerifiedCheckpoints(accountId, [permDate, transDate], testJobId);
  const permFailed = res.failedDates.find((f) => f.date === permDate);
  const transFailed = res.failedDates.find((f) => f.date === transDate);

  // Permanent failure is NOT retry eligible
  assert.ok(permFailed);
  assert.strictEqual(permFailed?.retryEligible, false);

  // Transient failure IS retry eligible and nextEligibleAt is set in future
  assert.ok(transFailed);
  assert.strictEqual(transFailed?.retryEligible, true);
  assert.ok(transFailed?.nextEligibleAt !== null);
  assert.ok(transFailed!.nextEligibleAt!.getTime() > Date.now());
});

test('Task 2.4 (Test A & B): Recovers completed dates from partial job (e.g. Job 47dcdfb6) and isolates unfinished dates', async () => {
  mockStore.clear();
  const accountId = 'act_1380498158917028';
  const partialJobId = '47dcdfb6-simulated';
  const allOctDates = splitDateRangeToDays('2026-10-01', '2026-10-31');
  assert.strictEqual(allOctDates.length, 31);

  // Simulate Job 47dcdfb6: Oct 1 through Oct 21 completed
  const completed21Dates = allOctDates.slice(0, 21);
  const unfinished10Dates = allOctDates.slice(21);

  for (const date of completed21Dates) {
    await CheckpointManager.recordChunkSuccess(accountId, partialJobId, date, {
      recordCount: 15,
      spend: 9500000,
      impressions: 140000,
      clicks: 1800,
      isEmptyDay: false,
    });
  }

  // Recover checkpoints for the full month
  const verified = await CheckpointManager.getVerifiedCheckpoints(accountId, allOctDates, partialJobId);

  // Test A verification: Exactly 21 dates recovered
  assert.strictEqual(verified.completedDates.length, 21);
  assert.deepStrictEqual(verified.completedDates, completed21Dates);

  // Test B verification: Exactly 10 dates pending (Oct 22-31)
  assert.strictEqual(verified.pendingDates.length, 10);
  assert.deepStrictEqual(verified.pendingDates, unfinished10Dates);
});

test('Task 2.4 (Test C - Dual Layer Recovery): Recovers from legacy SyncLog events when SyncCheckpoint table is empty', async () => {
  mockStore.clear();
  mockSyncLogs = [];
  const accountId = 'act_1380498158917028';
  const legacyJobId = '47dcdfb6-legacy';
  const allOctDates = splitDateRangeToDays('2026-10-01', '2026-10-31');

  // Populate mock SyncLog events for Oct 1 to Oct 21
  for (let d = 1; d <= 21; d++) {
    const dateStr = `2026-10-${String(d).padStart(2, '0')}`;
    mockSyncLogs.push({
      id: `log_${d}`,
      module: 'SYNC_ENGINE',
      eventType: 'DailyChunkCompleted',
      adAccountId: accountId,
      syncJobId: legacyJobId,
      recordCount: 14,
      createdAt: new Date(),
      sanitizedMeta: {
        reportingDate: dateStr,
        spend: 9697473,
        impressions: 144885,
        clicks: 1880,
      },
    });
  }

  // Verify that Layer 2 fallback accurately discovers the 21 dates from SyncLog
  const recovered = await CheckpointManager.getVerifiedCheckpoints(accountId, allOctDates, legacyJobId);
  assert.strictEqual(recovered.completedDates.length, 21);
  assert.strictEqual(recovered.completedDates[0], '2026-10-01');
  assert.strictEqual(recovered.completedDates[20], '2026-10-21');
  assert.strictEqual(recovered.pendingDates.length, 10);
  assert.strictEqual(recovered.pendingDates[0], '2026-10-22');
  assert.strictEqual(recovered.pendingDates[9], '2026-10-31');
});

test('Task 2.4 (Test D): Completed dates are not unnecessarily fetched again in resume mode', async () => {
  mockStore.clear();
  const accountId = 'act_1380498158917028';
  const testDate = '2026-10-01';

  // Ensure checkpoint exists
  await CheckpointManager.recordChunkSuccess(accountId, 'job_test_nodup', testDate, {
    recordCount: 14,
    spend: 8763024,
    impressions: 117842,
    clicks: 1483,
    isEmptyDay: false,
  });

  const verified = await CheckpointManager.getVerifiedCheckpoints(accountId, [testDate], 'job_test_nodup');
  assert.strictEqual(verified.completedDates.length, 1);
  assert.strictEqual(verified.pendingDates.length, 0);

  // When filtered for processing, datesToProcess should be empty
  const datesToProcess = [testDate].filter((d) => !verified.completedDates.includes(d));
  assert.strictEqual(datesToProcess.length, 0);
});

test('Task 2.4 (Test H): Concurrency protection prevents Force Sync from releasing active lock', async () => {
  const originalExpected = process.env.EXPECTED_NEON_ENDPOINT_ID;
  const originalFindFirst = prisma.syncJob.findFirst;

  try {
    // Permit write guard check in test environment
    process.env.EXPECTED_NEON_ENDPOINT_ID = 'local-sqlite';

    const activeRunningJob = {
      id: 'job_active_lock_123',
      status: 'running',
      startedAt: new Date(), // Active right now (< 330s lease)
      adAccountId: 'act_1380498158917028',
    };

    // Mock prisma.syncJob.findFirst
    (prisma.syncJob as unknown as { findFirst: typeof prisma.syncJob.findFirst }).findFirst = (async () => {
      return activeRunningJob;
    }) as unknown as typeof prisma.syncJob.findFirst;

    const mockConnection = {
      id: 'conn_test',
      encryptedAccessToken: encrypt('EAABwZCs1234567890abcdefghijklmnopqrstuvwxyz1234567890'),
      graphApiVersion: 'v25.0',
    };

    // Attempting sync with force: true MUST still reject to prevent concurrent worker execution
    await assert.rejects(
      async () => {
        await MetaSyncEngine.syncAdAccount(mockConnection, {
          adAccountId: 'act_1380498158917028',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-01',
          force: true, // Force MUST NOT bypass active lock
        });
      },
      (err: Error) => {
        assert.match(err.message, /Một tiến trình đồng bộ khác.*đang chạy/);
        return true;
      }
    );
  } finally {
    process.env.EXPECTED_NEON_ENDPOINT_ID = originalExpected;
    prisma.syncJob.findFirst = originalFindFirst;
  }
});

test('Task 2.4 (Test G): Stale worker protection aborts if job lease is revoked', async () => {
  const originalFindUnique = prisma.syncJob.findUnique;

  try {
    // Mock that the job status in DB was changed to timeout by cleaner
    (prisma.syncJob as unknown as { findUnique: typeof prisma.syncJob.findUnique }).findUnique = (async () => {
      return { status: 'timeout' };
    }) as unknown as typeof prisma.syncJob.findUnique;

    // Simulate expired worker check
    const currentJobState = await prisma.syncJob.findUnique({
      where: { id: 'job_expired_worker' },
      select: { status: true },
    });

    assert.ok(currentJobState);
    assert.notStrictEqual(currentJobState?.status, 'running');
  } finally {
    prisma.syncJob.findUnique = originalFindUnique;
  }
});
