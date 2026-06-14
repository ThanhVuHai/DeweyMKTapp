/**
 * Safely performs division, protecting against division by zero
 */
export function safeDivide(numerator: number, denominator: number, fallback: number | null = 0): number | null {
  if (!denominator || denominator === 0) {
    return fallback;
  }
  return numerator / denominator;
}

/**
 * Interface representing standard aggregated insights metrics
 */
export interface InsightMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  qualifiedLeads?: number;
  wlLeads?: number;
}

/**
 * Calculates standard ads performance metrics
 */
export function calculateMetrics(data: InsightMetrics) {
  const { spend, impressions, reach, clicks, linkClicks, leads, qualifiedLeads = 0, wlLeads = 0 } = data;

  const ctr = (safeDivide(clicks, impressions) || 0) * 100; // in %
  const linkClickCtr = (safeDivide(linkClicks, impressions) || 0) * 100; // in %
  const cpc = safeDivide(spend, clicks) || 0;
  const cpm = (safeDivide(spend, impressions) || 0) * 1000;
  const cpl = safeDivide(spend, leads, null); // Return null instead of 0 for CPL to indicate no leads
  const frequency = safeDivide(impressions, reach) || 1.0;

  // CRM Funnel Metrics
  const leadToQlRate = (safeDivide(qualifiedLeads, leads) || 0) * 100; // in %
  const qlToWlRate = (safeDivide(wlLeads, qualifiedLeads) || 0) * 100; // in %
  const leadToWlRate = (safeDivide(wlLeads, leads) || 0) * 100; // in %
  
  const cpql = safeDivide(spend, qualifiedLeads, null);
  const cpwl = safeDivide(spend, wlLeads, null);

  return {
    ctr,
    linkClickCtr,
    cpc,
    cpm,
    cpl,
    frequency,
    leadToQlRate,
    qlToWlRate,
    leadToWlRate,
    cpql,
    cpwl
  };
}

/**
 * Calculates budget pacing metrics for a month
 * @param spend Total spend in the period
 * @param monthlyBudget Total target budget
 * @param daysPassed Days passed in the target month
 * @param totalDays Total days in the target month
 */
export function calculatePacing(
  spend: number,
  monthlyBudget: number,
  daysPassed: number,
  totalDays: number
) {
  const budgetUsedPct = (safeDivide(spend, monthlyBudget) || 0) * 100;
  const timePassedPct = (safeDivide(daysPassed, totalDays) || 0) * 100;
  const pacingGap = budgetUsedPct - timePassedPct; // Positive means spending faster than time

  return {
    budgetUsedPct,
    timePassedPct,
    pacingGap
  };
}

/**
 * Calculates forecasts based on run-rate
 */
export function calculateForecast(
  currentValue: number,
  daysPassed: number,
  totalDays: number
) {
  if (daysPassed <= 0) return 0;
  return (currentValue / daysPassed) * totalDays;
}

/**
 * Format currency with custom rules:
 * - >= 1,000,000 -> 1.0tr (VND)
 * - >= 1,000 -> k (VND)
 * - Else raw number
 */
export function formatVND(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'N/A';
  
  if (amount >= 1000000) {
    const value = amount / 1000000;
    return `${value.toFixed(1).replace('.0', '')}tr`;
  }
  
  if (amount >= 1000) {
    const value = Math.round(amount / 1000);
    return `${value}k`;
  }
  
  return Math.round(amount).toString();
}

/**
 * Format currency strictly as standard VND with separators
 */
export function formatVNDFull(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })
    .format(amount)
    .replace('₫', 'đ');
}

/**
 * Format double values into percentage string (e.g. 1.25%)
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(2)}%`;
}

/**
 * Format large numbers to human-readable form (e.g. 1.2M, 50k, etc.)
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1).replace('.0', '')}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace('.0', '')}k`;
  }
  return num.toString();
}

/**
 * Formats date into dd/MM/yyyy
 */
export function formatDate(date: Date | string | number): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}/${month}/${year}`;
}
