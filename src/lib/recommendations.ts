import { calculateMetrics, safeDivide } from './metrics';

export interface AdBenchmarkConfig {
  minTestSpend: number;       // e.g. 1000000 VND
  minLeads: number;           // e.g. 5
  goodCpl: number;            // e.g. 200000 VND
  averageCpl: number;          // e.g. 400000 VND
  badCpl: number;             // e.g. 600000 VND
  goodCpql?: number;          // e.g. 500000 VND
  badCpql?: number;           // e.g. 1000000 VND
  ctrBenchmark: number;       // e.g. 1.0%
  cpmBenchmark: number;       // e.g. 150000 VND
  frequencyThreshold: number; // e.g. 3.0
  cutSpendThreshold: number;  // e.g. 2500000 VND
  leadToQlTarget?: number;    // e.g. 30%
  qlToWlTarget?: number;      // e.g. 20%
}

export const DEFAULT_BENCHMARK: AdBenchmarkConfig = {
  minTestSpend: 1000000,
  minLeads: 5,
  goodCpl: 250000,
  averageCpl: 450000,
  badCpl: 600000,
  goodCpql: 600000,
  badCpql: 1200000,
  ctrBenchmark: 1.0, // 1%
  cpmBenchmark: 120000,
  frequencyThreshold: 3.0,
  cutSpendThreshold: 2000000,
  leadToQlTarget: 30, // 30%
  qlToWlTarget: 20, // 20%
};

export interface ObjectInsights {
  id: string; // Meta ID (campaignId, adsetId, adId) or Name
  name: string;
  type: 'campaign' | 'adset' | 'ad' | 'content';
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  qualifiedLeads?: number;
  wlLeads?: number;
  // Trend data over 3 days (e.g. comparing last 3 days to prior 3 days)
  ctrTrend3Days?: number; // percent change (e.g., -25 means -25% drop)
  cpcTrend3Days?: number; // percent change
  cplTrend3Days?: number; // percent change
}

export interface GeneratedRecommendation {
  objectId: string;
  objectName: string;
  objectType: 'campaign' | 'adset' | 'ad' | 'content';
  recommendationType: 'SCALE' | 'HOLD' | 'TEST' | 'REVIEW' | 'CUT' | 'REFRESH_CREATIVE' | 'CHECK_LEAD_QUALITY' | 'CHECK_SALES' | 'CHECK_FORM' | 'CHECK_LANDING_PAGE' | 'CHECK_TARGETING';
  severity: 'low' | 'medium' | 'high';
  title: string;
  reason: string;
  evidence: {
    spend: number;
    leads: number;
    cpl: number | null;
    ctr: number;
    frequency: number;
    cpql?: number | null;
    leadToQlRate?: number;
    qlToWlRate?: number;
    [key: string]: any;
  };
}

/**
 * RecommendationEngine generates programmatic suggestions for optimizing ad deliverables
 */
export function generateRecommendationForObject(
  obj: ObjectInsights,
  benchmark: AdBenchmarkConfig = DEFAULT_BENCHMARK
): GeneratedRecommendation {
  const metrics = calculateMetrics({
    spend: obj.spend,
    impressions: obj.impressions,
    reach: obj.reach,
    clicks: obj.clicks,
    linkClicks: obj.linkClicks,
    leads: obj.leads,
    qualifiedLeads: obj.qualifiedLeads || 0,
    wlLeads: obj.wlLeads || 0,
  });

  const { ctr, cpc, cpm, cpl, frequency, leadToQlRate, qlToWlRate, cpql, cpwl } = metrics;
  const targetCpl = benchmark.goodCpl;
  const targetCtr = benchmark.ctrBenchmark;
  
  const evidence: any = {
    spend: obj.spend,
    leads: obj.leads,
    cpl: cpl,
    ctr: ctr,
    frequency: frequency,
    cpc: cpc,
    cpm: cpm
  };

  if (obj.qualifiedLeads !== undefined) {
    evidence.qualifiedLeads = obj.qualifiedLeads;
    evidence.leadToQlRate = leadToQlRate;
    evidence.cpql = cpql;
  }
  if (obj.wlLeads !== undefined) {
    evidence.wlLeads = obj.wlLeads;
    evidence.qlToWlRate = qlToWlRate;
    evidence.cpwl = cpwl;
  }

  const formatVND = (val: number | null) => {
    if (val === null) return 'N/A';
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}tr`;
    if (val >= 1000) return `${Math.round(val / 1000)}k`;
    return Math.round(val).toString();
  };

  // 1. TEST Rule (Not enough data)
  if (obj.spend < benchmark.minTestSpend) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'TEST',
      severity: 'low',
      title: 'Đang trong quá trình thử nghiệm',
      reason: `Chi phí đã chi tiêu (${formatVND(obj.spend)}) chưa đạt ngân sách thử nghiệm tối thiểu (${formatVND(benchmark.minTestSpend)}). Cần tiếp tục theo dõi thêm để thu thập đủ dữ liệu đưa ra kết luận chính xác.`,
      evidence,
    };
  }

  // 2. CUT Rule (Spent too much, zero conversion or CPL extremely high)
  const isCutBudgetReached = obj.spend >= benchmark.cutSpendThreshold;
  const isCplExtremelyHigh = cpl !== null && cpl > benchmark.badCpl;
  const hasZeroLeads = obj.leads === 0;

  if (isCutBudgetReached && (hasZeroLeads || isCplExtremelyHigh)) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'CUT',
      severity: 'high',
      title: 'Dừng quảng cáo lập tức (CUT)',
      reason: hasZeroLeads 
        ? `Quảng cáo đã tiêu ${formatVND(obj.spend)} (vượt ngưỡng cắt ${formatVND(benchmark.cutSpendThreshold)}) nhưng KHÔNG tạo ra Lead nào. Đề xuất tắt ngay lập tức để bảo vệ ngân sách.`
        : `Quảng cáo đã tiêu ${formatVND(obj.spend)} với chi phí mỗi Lead (CPL) là ${formatVND(cpl)} (vượt xa ngưỡng tối đa chấp nhận được ${formatVND(benchmark.badCpl)}). Hãy tắt quảng cáo này.`,
      evidence,
    };
  }

  // 3. REFRESH CREATIVE Rule (High frequency, drop in CTR, increase in cost)
  const isCreativeFatigued = 
    frequency >= benchmark.frequencyThreshold && 
    obj.ctrTrend3Days !== undefined && 
    obj.ctrTrend3Days < -20; // CTR decreased by more than 20% in the last 3 days

  if (isCreativeFatigued) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'REFRESH_CREATIVE',
      severity: 'medium',
      title: 'Đổi mới nội dung sáng tạo (Refresh Creative)',
      reason: `Tần suất hiển thị đã đạt ${frequency.toFixed(2)} (vượt ngưỡng mệt mỏi ${benchmark.frequencyThreshold}) đồng thời CTR giảm ${Math.abs(obj.ctrTrend3Days || 0).toFixed(0)}% trong 3 ngày qua. Định dạng hoặc nội dung này đã bị bão hòa. Hãy thay thế nội dung, hình ảnh hoặc tiêu đề mới.`,
      evidence,
    };
  }

  // 4. CHECK LEAD QUALITY Rule (Good CPL but low Lead -> Qualified Lead Rate)
  const leadToQlBenchmark = benchmark.leadToQlTarget || 30;
  const hasLowLeadQuality = 
    obj.leads >= benchmark.minLeads && 
    obj.qualifiedLeads !== undefined && 
    leadToQlRate < leadToQlBenchmark &&
    (cpl !== null && cpl <= benchmark.averageCpl);

  if (hasLowLeadQuality) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'CHECK_LEAD_QUALITY',
      severity: 'medium',
      title: 'Kiểm tra chất lượng Lead (Check Lead Quality)',
      reason: `Chi phí mỗi Lead khá rẻ (${formatVND(cpl)}), lượng Lead lớn (${obj.leads}) nhưng tỷ lệ chuyển đổi Lead sang Lead Chất Lượng (QL) chỉ đạt ${leadToQlRate.toFixed(1)}% (thấp hơn benchmark ${leadToQlBenchmark}%). Vấn đề có thể nằm ở việc nhắm mục tiêu (Targeting) bị lệch tệp khách hàng hoặc tiêu đề quảng cáo gây hiểu lầm (Content Promise).`,
      evidence,
    };
  }

  // 5. CHECK SALES Rule (Qualified Leads are fine, but low Qualified -> WL)
  const qlToWlBenchmark = benchmark.qlToWlTarget || 20;
  const hasLowSalesConversion =
    obj.qualifiedLeads !== undefined &&
    obj.qualifiedLeads >= 3 &&
    obj.wlLeads !== undefined &&
    qlToWlRate < qlToWlBenchmark;

  if (hasLowSalesConversion) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'CHECK_SALES',
      severity: 'medium',
      title: 'Kiểm tra quy trình Sales / Tư vấn (Check Sales)',
      reason: `Dữ liệu quảng cáo mang lại lượng Lead chất lượng tốt (${obj.qualifiedLeads} QL) nhưng tỷ lệ chuyển đổi sang đăng ký WL chỉ đạt ${qlToWlRate.toFixed(1)}% (benchmark ${qlToWlBenchmark}%). Đề xuất kiểm tra tốc độ liên hệ của bộ phận tư vấn, kịch bản xử lý từ chối (tuition objections) hoặc sự phù hợp của ưu đãi/offer hiện tại.`,
      evidence,
    };
  }

  // 6. SCALE Rule (Good cost, good conversion volume, low frequency)
  const isScaleReady = 
    obj.leads >= benchmark.minLeads &&
    cpl !== null && cpl <= benchmark.goodCpl &&
    ctr >= benchmark.ctrBenchmark &&
    frequency < benchmark.frequencyThreshold &&
    (cpql === null || cpql === undefined || (benchmark.goodCpql && cpql <= benchmark.goodCpql));

  if (isScaleReady) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'SCALE',
      severity: 'medium',
      title: 'Nhân rộng & Tăng ngân sách (SCALE)',
      reason: `Quảng cáo đang hoạt động cực tốt. CPL chỉ ${formatVND(cpl)} (ngưỡng tốt là ${formatVND(benchmark.goodCpl)}), CTR đạt ${ctr.toFixed(2)}% (benchmark ${benchmark.ctrBenchmark}%) và tần suất hiển thị an toàn (${frequency.toFixed(2)}). Đề xuất tăng ngân sách hàng ngày lên 10-20% hoặc sao chép content angle này sang nhóm đối tượng mới.`,
      evidence,
    };
  }

  // 7. REVIEW Rule (High cost but not extremely critical, or low CTR)
  const needsReview =
    (cpl !== null && cpl > benchmark.averageCpl) ||
    ctr < benchmark.ctrBenchmark ||
    cpm > benchmark.cpmBenchmark;

  if (needsReview) {
    return {
      objectId: obj.id,
      objectName: obj.name,
      objectType: obj.type,
      recommendationType: 'REVIEW',
      severity: 'medium',
      title: 'Cần tối ưu quảng cáo (REVIEW)',
      reason: cpl !== null && cpl > benchmark.averageCpl
        ? `Chi phí CPL đạt ${formatVND(cpl)}, cao hơn mức trung bình (${formatVND(benchmark.averageCpl)}). Hãy kiểm tra lại đối tượng nhắm mục tiêu hoặc tối ưu hóa Landing Page.`
        : ctr < benchmark.ctrBenchmark
          ? `Tỷ lệ nhấp chuột (CTR) thấp (${ctr.toFixed(2)}% so với benchmark ${benchmark.ctrBenchmark}%). CTR thấp báo hiệu tiêu đề hoặc hình ảnh (hook/creative) chưa thu hút. Cần thử nghiệm các mẫu thiết kế hoặc cách viết hook mới.`
          : `Chi phí mỗi 1000 lượt hiển thị (CPM) quá cao (${formatVND(cpm)} so với benchmark ${formatVND(benchmark.cpmBenchmark)}). CPM cao báo hiệu thị trường cạnh tranh lớn hoặc phân phối quảng cáo gặp lỗi phân phối (Audience/Placements).`,
      evidence,
    };
  }

  // 8. HOLD Rule (Steady performance, keep monitoring)
  return {
    objectId: obj.id,
    objectName: obj.name,
    objectType: obj.type,
    recommendationType: 'HOLD',
    severity: 'low',
    title: 'Tiếp tục duy trì theo dõi (HOLD)',
    reason: `Các chỉ số quảng cáo (Spend: ${formatVND(obj.spend)}, CPL: ${formatVND(cpl)}, CTR: ${ctr.toFixed(2)}%) nằm trong tầm kiểm soát ổn định. Đề xuất tiếp tục giữ nguyên ngân sách và theo dõi hiệu suất phân phối định kỳ hàng ngày.`,
    evidence,
  };
}
