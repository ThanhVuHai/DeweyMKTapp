import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Configurable statuses for lead qualification
// - qualified_lead = directly qualified lead
// - wl (waiting list) and enrolled are included because they are later funnel stages that have already passed QL
// TODO: Move this definition to application settings or administrator configuration database table in Phase 2
const QUALIFIED_LEAD_STATUSES = ['qualified_lead', 'wl', 'enrolled'];

// Mathematical Helper Functions to prevent NaN, division by zero, or null pointer exceptions
function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator === 0) return 0;
  return numerator / denominator;
}

function safeRate(numerator: number, denominator: number): number {
  return safeDivide(numerator, denominator) * 100;
}

function safeCost(spend: number, conversions: number): number | null {
  if (spend <= 0 || conversions <= 0) return null;
  return spend / conversions;
}

function safePercentageChange(current: number, historical: number): number {
  if (!historical || historical === 0) return 0;
  return ((current - historical) / historical) * 100;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFromStr = searchParams.get('dateFrom');
    const dateToStr = searchParams.get('dateTo');
    const campusFilter = searchParams.get('campus') || undefined;
    const gradeFilter = searchParams.get('grade') || undefined;
    const sourceFilter = searchParams.get('source') || undefined;
    const accountIdFilter = searchParams.get('accountId') || undefined;

    // 1. Mandatory Date Check
    if (!dateFromStr || !dateToStr) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required.' },
        { status: 400 }
      );
    }

    const start = new Date(dateFromStr);
    const end = new Date(dateToStr);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date formats provided.' },
        { status: 400 }
      );
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 2. Historical Date Range calculation for Diagnostics comparison
    const durationMs = end.getTime() - start.getTime();
    const histStart = new Date(start.getTime() - durationMs - 1);
    const histEnd = new Date(start.getTime() - 1);

    // 3. Ingestion Query fetching unified insights and leads data
    const insights = await prisma.insightsDaily.findMany({
      where: {
        level: 'ad',
        adAccountId: accountIdFilter,
        date: {
          gte: histStart,
          lte: end,
        }
      }
    });

    const crmLeads = await prisma.crmLead.findMany({
      where: {
        leadDate: {
          gte: histStart,
          lte: end,
        }
      }
    });

    const insightAdIds = insights.map(i => i.adId);
    const leadAdIds = crmLeads.map(l => l.adId).filter((id): id is string => !!id);
    const allAdIds = Array.from(new Set([...insightAdIds, ...leadAdIds]));

    // Core Relational Join: InsightsDaily.adId -> Ad.adId -> Ad.id -> ContentMapping.adId
    const ads = await prisma.ad.findMany({
      where: { adId: { in: allAdIds } },
      include: { contentMapping: true }
    });

    const adMap = new Map();
    ads.forEach(ad => {
      adMap.set(ad.adId, ad);
    });

    // 4. KPI target setup based on target dateTo month/year boundaries
    // NOTE: KPI target mapping use the month of dateTo for Sprint 1A.
    const targetMonth = end.getMonth() + 1;
    const targetYear = end.getFullYear();
    const kpiTargets = await prisma.kpiTarget.findMany({
      where: {
        month: targetMonth,
        year: targetYear,
      }
    });

    // 5. In-Memory Filter logic
    const matchFilters = (adId: string, campaignName: string) => {
      const ad = adMap.get(adId);
      const mapping = ad?.contentMapping;
      if (campusFilter && (!mapping || mapping.campus !== campusFilter)) return false;
      if (gradeFilter && (!mapping || mapping.grade !== gradeFilter)) return false;
      
      if (sourceFilter) {
        const isLeadAds = campaignName?.includes('VIDEO') || campaignName?.includes('LEADS');
        const isMsg = campaignName?.includes('MSG') || campaignName?.includes('MESSENGER');
        const adSource = isLeadAds ? 'LeadAds' : isMsg ? 'Messenger' : 'Conversion';
        if (adSource !== sourceFilter) return false;
      }
      return true;
    };

    const matchLeadFilters = (l: any) => {
      if (campusFilter && l.campus !== campusFilter) return false;
      if (gradeFilter && l.grade !== gradeFilter) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      return true;
    };

    // 6. Partition datasets into current and historical lists
    const currentInsights = insights.filter(i => i.date >= start && i.date <= end && matchFilters(i.adId, i.campaignName));
    const historicalInsights = insights.filter(i => i.date >= histStart && i.date <= histEnd && matchFilters(i.adId, i.campaignName));
    const currentLeads = crmLeads.filter(l => l.leadDate >= start && l.leadDate <= end && matchLeadFilters(l));
    const historicalLeads = crmLeads.filter(l => l.leadDate >= histStart && l.leadDate <= histEnd && matchLeadFilters(l));

    // 7. Summary Ingestion aggregation
    let spend = 0;
    let impressions = 0;
    let reach = 0;
    let clicks = 0;
    let leads = 0;

    currentInsights.forEach(i => {
      spend += i.spend;
      impressions += i.impressions;
      reach += i.reach;
      clicks += i.clicks;
      leads += i.leads;
    });

    const qualifiedLeads = currentLeads.filter(l => QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)).length;
    const leadToQlRate = safeRate(qualifiedLeads, leads);

    const ctr = safeRate(clicks, impressions);
    const cpc = safeDivide(spend, clicks);
    const cpm = safeDivide(spend, impressions) * 1000;
    const cpl = safeCost(spend, leads);
    const cpql = safeCost(spend, qualifiedLeads);

    const filteredKpis = kpiTargets.filter(k => {
      if (campusFilter && k.campus !== campusFilter) return false;
      if (gradeFilter && k.grade !== gradeFilter) return false;
      if (sourceFilter && k.source !== sourceFilter) return false;
      return true;
    });

    let kpiTargetQL = 0;
    filteredKpis.forEach(k => {
      kpiTargetQL += k.targetQualifiedLeads;
    });

    const qlGap = Math.max(kpiTargetQL - qualifiedLeads, 0);
    const qlAchievementRate = safeRate(qualifiedLeads, kpiTargetQL);

    // Forecast Logic: Correct same-month vs different-month check
    let qlForecast: number | null = null;
    let forecastNote = '';
    const isSameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();

    if (isSameMonth) {
      const startDay = start.getDate();
      const endDay = end.getDate();
      const selectedDaysInRange = (endDay - startDay) + 1;
      const daysInMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
      qlForecast = Math.round((qualifiedLeads / selectedDaysInRange) * daysInMonth);
      forecastNote = 'Forecast is calculated from selected range within the same month.';
    } else {
      qlForecast = null;
      forecastNote = 'Forecast is only available when dateFrom and dateTo are in the same month.';
    }

    const currentDay = end.getDate();
    const daysInMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    const pacingRatio = (currentDay / daysInMonth) * 0.85;

    // 8. Segment Breakdown grouping
    const segmentMap = new Map();
    const getSegmentKey = (c: string, g: string, s: string) => `${c}_${g}_${s}`;

    currentInsights.forEach(i => {
      const ad = adMap.get(i.adId);
      const mapping = ad?.contentMapping;
      const campus = mapping?.campus || 'unattributed';
      const grade = mapping?.grade || 'unattributed';
      
      const isLeadAds = i.campaignName?.includes('VIDEO') || i.campaignName?.includes('LEADS');
      const isMsg = i.campaignName?.includes('MSG') || i.campaignName?.includes('MESSENGER');
      const source = isLeadAds ? 'LeadAds' : isMsg ? 'Messenger' : 'Conversion';

      const key = getSegmentKey(campus, grade, source);
      if (!segmentMap.has(key)) {
        segmentMap.set(key, { campus, grade, source, spend: 0, leads: 0, qualifiedLeads: 0 });
      }
      const seg = segmentMap.get(key);
      seg.spend += i.spend;
      seg.leads += i.leads;
    });

    currentLeads.forEach(l => {
      if (QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)) {
        const campus = l.campus || 'unattributed';
        const grade = l.grade || 'unattributed';
        const source = l.source || 'unattributed';

        const key = getSegmentKey(campus, grade, source);
        if (!segmentMap.has(key)) {
          segmentMap.set(key, { campus, grade, source, spend: 0, leads: 0, qualifiedLeads: 0 });
        }
        const seg = segmentMap.get(key);
        seg.qualifiedLeads++;
      }
    });

    const segmentBreakdown = Array.from(segmentMap.values()).map((seg: any) => {
      const segKpis = kpiTargets.filter(k => k.campus === seg.campus && k.grade === seg.grade && k.source === seg.source);
      const segKpiTargetQL = segKpis.reduce((sum, k) => sum + k.targetQualifiedLeads, 0);
      const segQlGap = Math.max(segKpiTargetQL - seg.qualifiedLeads, 0);

      const expectedRatio = pacingRatio;
      const achievementRatio = segKpiTargetQL > 0 ? seg.qualifiedLeads / segKpiTargetQL : 1;

      let status = 'on_track';
      if (segKpiTargetQL > 0) {
        if (achievementRatio < expectedRatio * 0.5) status = 'critical';
        else if (achievementRatio < expectedRatio * 0.8) status = 'at_risk';
      }

      return {
        campus: seg.campus,
        grade: seg.grade,
        source: seg.source,
        spend: seg.spend,
        leads: seg.leads,
        qualifiedLeads: seg.qualifiedLeads,
        leadToQlRate: safeRate(seg.qualifiedLeads, seg.leads),
        cpl: safeCost(seg.spend, seg.leads),
        cpql: safeCost(seg.spend, seg.qualifiedLeads),
        kpiTargetQL: segKpiTargetQL,
        qlGap: segQlGap,
        status
      };
    });

    // 9. Content Attribution grouping
    const contentMap = new Map();
    const getContentKey = (a: string, h: string, f: string, c: string) => `${a}_${h}_${f}_${c}`;

    currentInsights.forEach(i => {
      const ad = adMap.get(i.adId);
      const mapping = ad?.contentMapping;
      const angle = mapping?.angle || 'Unattributed';
      const hookType = mapping?.hookType || 'Unknown';
      const format = mapping?.format || 'Unknown';
      const creator = mapping?.creator || 'Unknown';

      const key = getContentKey(angle, hookType, format, creator);
      if (!contentMap.has(key)) {
        contentMap.set(key, { angle, hookType, format, creator, spend: 0, leads: 0, qualifiedLeads: 0 });
      }
      const group = contentMap.get(key);
      group.spend += i.spend;
      group.leads += i.leads;
    });

    currentLeads.forEach(l => {
      if (QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)) {
        const ad = adMap.get(l.adId);
        const mapping = ad?.contentMapping;
        const angle = mapping?.angle || 'Unattributed';
        const hookType = mapping?.hookType || 'Unknown';
        const format = mapping?.format || 'Unknown';
        const creator = mapping?.creator || 'Unknown';

        const key = getContentKey(angle, hookType, format, creator);
        if (!contentMap.has(key)) {
          contentMap.set(key, { angle, hookType, format, creator, spend: 0, leads: 0, qualifiedLeads: 0 });
        }
        const group = contentMap.get(key);
        group.qualifiedLeads++;
      }
    });

    const contentAttribution = Array.from(contentMap.values()).map((c: any) => ({
      angle: c.angle,
      hookType: c.hookType,
      format: c.format,
      creator: c.creator,
      spend: c.spend,
      leads: c.leads,
      qualifiedLeads: c.qualifiedLeads,
      leadToQlRate: safeRate(c.qualifiedLeads, c.leads),
      cpl: safeCost(c.spend, c.leads),
      cpql: safeCost(c.spend, c.qualifiedLeads),
    }));

    // 10. Daily Trends aggregation
    const dailyMap = new Map();
    currentInsights.forEach(i => {
      const dateStr = i.date.toISOString().split('T')[0];
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, { date: dateStr, spend: 0, leads: 0, qualifiedLeads: 0 });
      }
      const d = dailyMap.get(dateStr);
      d.spend += i.spend;
      d.leads += i.leads;
    });

    currentLeads.forEach(l => {
      if (QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)) {
        const dateStr = l.leadDate.toISOString().split('T')[0];
        if (!dailyMap.has(dateStr)) {
          dailyMap.set(dateStr, { date: dateStr, spend: 0, leads: 0, qualifiedLeads: 0 });
        }
        const d = dailyMap.get(dateStr);
        d.qualifiedLeads++;
      }
    });

    const dailyTrends = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d: any) => ({
        date: d.date,
        spend: d.spend,
        leads: d.leads,
        qualifiedLeads: d.qualifiedLeads,
        leadToQlRate: safeRate(d.qualifiedLeads, d.leads),
        cpl: safeCost(d.spend, d.leads),
        cpql: safeCost(d.spend, d.qualifiedLeads),
      }));

    // 11. Data Quality and Attribution Warnings
    const warnings: string[] = [];
    
    // Unmatched/Unattributed counts
    const unmatchedCrmLeads = currentLeads.filter(l => !l.adId || !adMap.has(l.adId)).length;
    const unmatchedInsights = currentInsights.filter(i => !adMap.has(i.adId)).length;
    const unattributedQualifiedLeads = currentLeads.filter(l => {
      if (!QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)) return false;
      const ad = adMap.get(l.adId);
      return !ad || !ad.contentMapping;
    }).length;

    // Trigger Warnings for Spend = 0 but QLs > 0
    segmentBreakdown.forEach(seg => {
      if (seg.spend <= 0 && seg.qualifiedLeads > 0) {
        warnings.push(`Qualified leads exist without matched ad spend in segment: ${seg.campus} - ${seg.grade} - ${seg.source} (QLs: ${seg.qualifiedLeads}).`);
      }
    });

    contentAttribution.forEach(c => {
      if (c.spend <= 0 && c.qualifiedLeads > 0) {
        warnings.push(`Qualified leads exist without matched ad spend in content group: ${c.angle} - ${c.hookType} - ${c.format} (QLs: ${c.qualifiedLeads}).`);
      }
    });

    dailyTrends.forEach(d => {
      if (d.spend <= 0 && d.qualifiedLeads > 0) {
        warnings.push(`Qualified leads exist without matched ad spend on date: ${d.date} (QLs: ${d.qualifiedLeads}).`);
      }
    });

    if (unmatchedCrmLeads > 0) {
      warnings.push(`Có ${unmatchedCrmLeads} CRM Leads không khớp với bất kỳ Meta Ad ID nào trong cơ sở dữ liệu.`);
    }
    if (unattributedQualifiedLeads > 0) {
      warnings.push(`Có ${unattributedQualifiedLeads} Qualified Leads chưa được cấu hình ContentMapping.`);
    }

    const dataQuality = {
      unmatchedCrmLeads,
      unmatchedInsights,
      unattributedQualifiedLeads,
      warnings
    };

    // 12. Diagnostics Analysis & Decision logic
    const diagnostics = [];
    let rulesEvaluated = 0;
    let alertsTriggered = 0;
    const skippedRules: { type: string; reason: string }[] = [];

    // Pre-aggregate historical metrics for comparison
    let histSpend = 0;
    let histImpressions = 0;
    let histClicks = 0;
    let histLeads = 0;

    historicalInsights.forEach(i => {
      histSpend += i.spend;
      histImpressions += i.impressions;
      histClicks += i.clicks;
      histLeads += i.leads;
    });

    const histQualifiedLeads = historicalLeads.filter(l => QUALIFIED_LEAD_STATUSES.includes(l.leadStatus)).length;
    const histCtr = safeRate(histClicks, histImpressions);
    const histCpl = safeCost(histSpend, histLeads);
    const histCpql = safeCost(histSpend, histQualifiedLeads);

    // Rule 1: QL down because CTR dropped
    rulesEvaluated++;
    const isQlDown = qualifiedLeads < histQualifiedLeads * 0.85;
    const isCtrDown = ctr < histCtr * 0.80;
    if (isQlDown && isCtrDown) {
      const isSampleSizeSufficient = histImpressions >= 10000 && impressions >= 5000;
      diagnostics.push({
        type: 'CTR_FATIGUE',
        severity: 'high',
        title: 'QL giảm do CTR sụt giảm (Tần suất hiển thị cao)',
        message: `Tỷ lệ nhấp CTR giảm từ ${histCtr.toFixed(2)}% xuống ${ctr.toFixed(2)}% và QL giảm từ ${histQualifiedLeads} xuống ${qualifiedLeads}. Có dấu hiệu mệt mỏi nội dung sáng tạo.`,
        rootCause: 'Frequency fatigue causing ad display decay and CTR drops.',
        recommendedActions: [
          'Rotate visual assets and titles on highly delivered ad creative sets.',
          'Inject alternative video formats or thumbnail configurations.'
        ],
        confidence: isSampleSizeSufficient ? (histImpressions >= 20000 ? 'high' : 'medium') : 'low',
        evidence: {
          currentCtr: ctr,
          historicalCtr: histCtr,
          currentQl: qualifiedLeads,
          historicalQl: histQualifiedLeads
        }
      });
      alertsTriggered++;
      if (!isSampleSizeSufficient) {
        skippedRules.push({
          type: 'CTR_FATIGUE',
          reason: `Confidence is marked low because of insufficient impressions (current: ${impressions}, historical: ${histImpressions}, required: >=10000 historical and >=5000 current).`
        });
      }
    } else {
      skippedRules.push({
        type: 'CTR_FATIGUE',
        reason: 'Trigger conditions not met: QL or CTR did not drop significantly relative to historical control.'
      });
    }

    // Rule 2: Lead up but QL down
    rulesEvaluated++;
    const isLeadsUp = leads > histLeads * 1.15;
    const isQlDownOrFlat = qualifiedLeads < histQualifiedLeads * 0.95;
    const isRateLow = leadToQlRate < 15;
    if ((isLeadsUp && isQlDownOrFlat) || (leads >= 10 && isRateLow)) {
      const isSampleSizeSufficient = leads >= 10;
      diagnostics.push({
        type: 'QUALITY_MISMATCH',
        severity: 'high',
        title: 'Leads tăng nhưng QL giảm (Sai lệch chất lượng tệp)',
        message: `Tổng Leads đạt ${leads} (tăng từ ${histLeads}), nhưng lượng QL giảm từ ${histQualifiedLeads} xuống ${qualifiedLeads}. Tỷ lệ Lead sang QL chỉ đạt ${leadToQlRate.toFixed(1)}%.`,
        rootCause: 'Broad audience target triggers low-intent leads or clickbait hook design.',
        recommendedActions: [
          'Add conditional qualification filters (like school district and student age) to the Meta Instant Form.',
          'Refine targeting limits and ensure the hook copy aligns with program value admissions speech.'
        ],
        confidence: isSampleSizeSufficient ? (leads >= 20 ? 'high' : 'medium') : 'low',
        evidence: {
          leads,
          historicalLeads: histLeads,
          qualifiedLeads,
          historicalQualifiedLeads: histQualifiedLeads,
          leadToQlRate
        }
      });
      alertsTriggered++;
      if (!isSampleSizeSufficient) {
        skippedRules.push({
          type: 'QUALITY_MISMATCH',
          reason: `Confidence is marked low because of insufficient leads in current period (leads: ${leads}, required: >=10).`
        });
      }
    } else {
      skippedRules.push({
        type: 'QUALITY_MISMATCH',
        reason: 'Trigger conditions not met: Leads did not increase while QL decreased/remained flat, and Lead-to-QL rate is not under 15%.'
      });
    }

    // Rule 3: CPL down but CPQL up
    rulesEvaluated++;
    const isCplDown = cpl !== null && histCpl !== null && cpl < histCpl * 0.85;
    const isCpqlUp = cpql !== null && histCpql !== null && cpql > histCpql * 1.20;
    if (isCplDown && isCpqlUp) {
      const isSampleSizeSufficient = leads >= 15 && qualifiedLeads > 0 && histQualifiedLeads > 0;
      diagnostics.push({
        type: 'PLACEMENT_BIAS',
        severity: 'medium',
        title: 'Giá Lead (CPL) giảm nhưng giá QL (CPQL) tăng',
        message: `Giá CPL trung bình giảm xuống ${cpl ? Math.round(cpl).toLocaleString() : 'N/A'}đ, nhưng giá mỗi QL tăng lên ${cpql ? Math.round(cpql).toLocaleString() : 'N/A'}đ (so với lịch sử ${histCpql ? Math.round(histCpql).toLocaleString() : 'N/A'}đ).`,
        rootCause: 'Algorithmic optimization re-routed delivery to low-cost mobile networks and low-intent placements.',
        recommendedActions: [
          'Disable Advantage+ Placements option inside Meta Campaign configuration.',
          'Restrict ad sets distributions to high-intent feeds (Facebook Feed, Instagram Feed).'
        ],
        confidence: isSampleSizeSufficient ? (leads >= 25 ? 'high' : 'medium') : 'low',
        evidence: {
          currentCpl: cpl,
          historicalCpl: histCpl,
          currentCpql: cpql,
          historicalCpql: histCpql
        }
      });
      alertsTriggered++;
      if (!isSampleSizeSufficient) {
        skippedRules.push({
          type: 'PLACEMENT_BIAS',
          reason: `Confidence is marked low because of insufficient conversions/leads (leads: ${leads}, current QL: ${qualifiedLeads}, historical QL: ${histQualifiedLeads}, required: >=15 leads and >0 QLs).`
        });
      }
    } else {
      skippedRules.push({
        type: 'PLACEMENT_BIAS',
        reason: 'Trigger conditions not met: CPL did not drop or CPQL did not rise.'
      });
    }

    // Rule 4: Campus underperforming
    rulesEvaluated++;
    let hasCampusDeficit = false;
    const campuses = ['CG', 'THT', 'HP'];
    campuses.forEach(campusName => {
      const campBreakdown = segmentBreakdown.find(s => s.campus === campusName);
      if (campBreakdown && campBreakdown.kpiTargetQL > 0) {
        const campAchievementRate = safeDivide(campBreakdown.qualifiedLeads, campBreakdown.kpiTargetQL);
        if (campAchievementRate < pacingRatio * 0.60) {
          const isSampleSizeSufficient = campBreakdown.kpiTargetQL >= 10;
          diagnostics.push({
            type: 'CAMPUS_DEFICIT',
            severity: 'high',
            title: `Cơ sở ${campusName} không đạt tiến độ KPI Qualified Leads`,
            message: `Cơ sở ${campusName} đạt ${campBreakdown.qualifiedLeads}/${campBreakdown.kpiTargetQL} QL (đạt ${(campAchievementRate * 100).toFixed(1)}% so với tiến độ Expected là ${(pacingRatio * 100).toFixed(1)}%).`,
            rootCause: 'Local market brand saturation or operational follow-up delay by advisors.',
            recommendedActions: [
              `Check lead qualification queue logs and response time averages for ${campusName} team.`,
              `Setup localized geo-targeting triggers within a 10km radius around the ${campusName} campus.`
            ],
            confidence: isSampleSizeSufficient ? 'high' : 'low',
            evidence: {
              campus: campusName,
              qualifiedLeads: campBreakdown.qualifiedLeads,
              targetQL: campBreakdown.kpiTargetQL,
              pacingRatio
            }
          });
          alertsTriggered++;
          hasCampusDeficit = true;
          if (!isSampleSizeSufficient) {
            skippedRules.push({
              type: `CAMPUS_DEFICIT_${campusName}`,
              reason: `Confidence is marked low because target QL is small (target QL: ${campBreakdown.kpiTargetQL}, required: >=10).`
            });
          }
        }
      }
    });
    if (!hasCampusDeficit) {
      skippedRules.push({
        type: 'CAMPUS_DEFICIT',
        reason: 'Trigger conditions not met: All campuses are meeting pacing targets relative to their KPIs.'
      });
    }

    // Rule 5: Content angle underperforming
    rulesEvaluated++;
    const badAngle = contentAttribution.find(c => c.spend > 1500000 && c.qualifiedLeads <= 1 && (c.cpql === null || c.cpql > 1200000));
    if (badAngle) {
      diagnostics.push({
        type: 'CREATIVE_WASTE',
        severity: 'medium',
        title: `Góc truyền thông (Angle) "${badAngle.angle}" hoạt động kém`,
        message: `Angle "${badAngle.angle}" đã chi tiêu ${Math.round(badAngle.spend).toLocaleString()}đ nhưng chỉ mang lại ${badAngle.qualifiedLeads} QL (CPQL đạt ${badAngle.cpql ? Math.round(badAngle.cpql).toLocaleString() + 'đ' : 'N/A'}).`,
        rootCause: 'Creative message angle fails to address major parent objections.',
        recommendedActions: [
          'De-allocate budget from the active underperforming angle.',
          'Re-route resources to top-converting angles (Curriculum Objection, Scholarship Tour).'
        ],
        confidence: 'high',
        evidence: {
          angle: badAngle.angle,
          spend: badAngle.spend,
          qualifiedLeads: badAngle.qualifiedLeads,
          cpql: badAngle.cpql
        }
      });
      alertsTriggered++;
    } else {
      skippedRules.push({
        type: 'CREATIVE_WASTE',
        reason: 'Trigger conditions not met: No content angles spent > 1.5M VND with <= 1 QL.'
      });
    }

    const diagnosticsMeta = {
      rulesEvaluated,
      alertsTriggered,
      skippedRules
    };

    return NextResponse.json({
      summary: {
        dateFrom: dateFromStr,
        dateTo: dateToStr,
        spend,
        impressions,
        reach,
        clicks,
        ctr,
        cpc,
        cpm,
        leads,
        qualifiedLeads,
        leadToQlRate,
        cpl,
        cpql,
        kpiTargetQL,
        qlGap,
        qlAchievementRate,
        qlForecast,
        forecastNote
      },
      segmentBreakdown,
      contentAttribution,
      dailyTrends,
      diagnostics,
      diagnosticsMeta,
      dataQuality
    });
  } catch (error: any) {
    console.error('QL Diagnosis API error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
