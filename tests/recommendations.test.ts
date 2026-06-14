import test from 'node:test';
import assert from 'node:assert';
import { generateRecommendationForObject, DEFAULT_BENCHMARK } from '../src/lib/recommendations';

test('TEST recommendation when spend is low', () => {
  const obj: any = {
    id: '1',
    name: 'Test Ad',
    type: 'ad',
    spend: 400000, // less than minTestSpend (1M)
    impressions: 10000,
    reach: 8000,
    clicks: 150,
    linkClicks: 100,
    leads: 2,
  };

  const rec = generateRecommendationForObject(obj, DEFAULT_BENCHMARK);
  assert.strictEqual(rec.recommendationType, 'TEST');
  assert.strictEqual(rec.severity, 'low');
  assert.ok(rec.reason.includes('chưa đạt ngân sách thử nghiệm'));
});

test('SCALE recommendation when metrics are excellent', () => {
  const obj: any = {
    id: '2',
    name: 'Awesome Win Ad',
    type: 'ad',
    spend: 1500000, // >= minTestSpend (1M)
    impressions: 80000,
    reach: 60000,
    clicks: 2000,
    linkClicks: 1500,
    leads: 15, // >= minLeads (5)
  };

  // CPL = 1500000 / 15 = 100,000 VND (<= goodCpl: 250,000)
  // CTR = 2000 / 80000 = 2.5% (>= ctrBenchmark: 1.0%)
  // Frequency = 80000 / 60000 = 1.33 (< frequencyThreshold: 3.0)

  const rec = generateRecommendationForObject(obj, DEFAULT_BENCHMARK);
  assert.strictEqual(rec.recommendationType, 'SCALE');
  assert.strictEqual(rec.severity, 'medium');
  assert.ok(rec.reason.includes('tăng ngân sách'));
});

test('CUT recommendation when overspent with poor results', () => {
  const obj: any = {
    id: '3',
    name: 'Bad Ad',
    type: 'ad',
    spend: 3000000, // >= cutSpendThreshold (2M)
    impressions: 120000,
    reach: 90000,
    clicks: 600,
    linkClicks: 400,
    leads: 0, // 0 leads!
  };

  const rec = generateRecommendationForObject(obj, DEFAULT_BENCHMARK);
  assert.strictEqual(rec.recommendationType, 'CUT');
  assert.strictEqual(rec.severity, 'high');
  assert.ok(rec.title.includes('Dừng quảng cáo'));
});

test('CHECK_LEAD_QUALITY recommendation when conversion is low', () => {
  const obj: any = {
    id: '4',
    name: 'High Volume Cheap Lead Ad',
    type: 'ad',
    spend: 1200000,
    impressions: 60000,
    reach: 45000,
    clicks: 1000,
    linkClicks: 800,
    leads: 12, // CPL = 100k (good!)
    qualifiedLeads: 1, // Lead -> QL rate = 1/12 = 8.3% (< leadToQlTarget: 30%)
  };

  const rec = generateRecommendationForObject(obj, DEFAULT_BENCHMARK);
  assert.strictEqual(rec.recommendationType, 'CHECK_LEAD_QUALITY');
  assert.strictEqual(rec.severity, 'medium');
  assert.ok(rec.title.includes('chất lượng Lead') || rec.reason.includes('Chất Lượng'));
});
