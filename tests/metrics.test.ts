import test from 'node:test';
import assert from 'node:assert';
import { safeDivide, calculateMetrics, formatVND, formatPercent, formatNumber } from '../src/lib/metrics';

test('safeDivide utility', () => {
  // Test normal division
  assert.strictEqual(safeDivide(10, 2), 5);
  
  // Test division by zero fallback
  assert.strictEqual(safeDivide(10, 0), 0);
  assert.strictEqual(safeDivide(10, 0, null), null);
});

test('calculateMetrics logic', () => {
  const metrics = calculateMetrics({
    spend: 1000000,
    impressions: 100000,
    reach: 50000,
    clicks: 1500,
    linkClicks: 1000,
    leads: 10,
    qualifiedLeads: 4,
    wlLeads: 2
  });

  // CTR = (1500 / 100000) * 100 = 1.5%
  assert.strictEqual(metrics.ctr, 1.5);
  
  // CPC = 1000000 / 1500 = 666.666
  assert.ok(metrics.cpc > 666 && metrics.cpc < 667);

  // CPM = (1000000 / 100000) * 1000 = 10000
  assert.strictEqual(metrics.cpm, 10000);

  // CPL = 1000000 / 10 = 100000
  assert.strictEqual(metrics.cpl, 100000);

  // Frequency = 100000 / 50000 = 2
  assert.strictEqual(metrics.frequency, 2);

  // Funnels conversion rates
  assert.strictEqual(metrics.leadToQlRate, 40); // 4/10 = 40%
  assert.strictEqual(metrics.qlToWlRate, 50); // 2/4 = 50%
  assert.strictEqual(metrics.leadToWlRate, 20); // 2/10 = 20%
});

test('formatting utilities', () => {
  // VND Format
  assert.strictEqual(formatVND(1200000), '1.2tr');
  assert.strictEqual(formatVND(450000), '450k');
  assert.strictEqual(formatVND(500), '500');

  // Percent Format
  assert.strictEqual(formatPercent(1.234), '1.23%');

  // Number Format
  assert.strictEqual(formatNumber(1500000), '1.5M');
  assert.strictEqual(formatNumber(45000), '45k');
});
