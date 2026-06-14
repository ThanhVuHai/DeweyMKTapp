import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateMetrics, safeDivide } from '@/lib/metrics';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');

    // Default dates: last 30 days
    const now = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(now.getDate() - 30);
    
    const start = dateFromParam ? new Date(dateFromParam) : defaultStart;
    const end = dateToParam ? new Date(dateToParam) : now;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const currentMonth = end.getMonth() + 1;
    const currentYear = end.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysPassed = end.getDate();
    const remainingDays = Math.max(1, daysInMonth - daysPassed);

    // 1. Fetch KPI Targets
    const kpiTargets = await prisma.kpiTarget.findMany({
      where: { month: currentMonth, year: currentYear }
    });

    // 2. Fetch Daily Insights at AD level
    const insights = await prisma.insightsDaily.findMany({
      where: { level: 'ad', date: { gte: start, lte: end } }
    });

    const adIds = Array.from(new Set(insights.map(i => i.adId)));
    const ads = await prisma.ad.findMany({
      where: { adId: { in: adIds } },
      include: { contentMapping: true }
    });

    const adMappingMap = new Map();
    ads.forEach(ad => {
      if (ad.contentMapping) adMappingMap.set(ad.adId, ad.contentMapping);
    });

    // Fetch CRM Leads
    const crmLeads = await prisma.crmLead.findMany({
      where: { leadDate: { gte: start, lte: end } }
    });

    // Join insights with ContentMapping for Segment Breakdown
    const campusGradeMap = new Map();
    
    // Initialize map from KPI targets to ensure all segments show
    kpiTargets.forEach(k => {
      const key = `${k.campus}_${k.grade}`;
      if (!campusGradeMap.has(key)) {
        campusGradeMap.set(key, {
          campus: k.campus,
          grade: k.grade,
          spend: 0,
          leads: 0,
          qualifiedLeads: 0,
          wlLeads: 0,
          targetLeads: k.targetLeads,
          targetQL: k.targetQualifiedLeads,
          targetWL: k.targetWl,
          monthlyBudget: k.monthlyBudget,
        });
      }
    });

    // Accumulate ad-spend and leads from insights
    insights.forEach(i => {
      const mapping = adMappingMap.get(i.adId);
      if (mapping && mapping.campus && mapping.grade) {
        const key = `${mapping.campus}_${mapping.grade}`;
        if (!campusGradeMap.has(key)) {
          campusGradeMap.set(key, {
            campus: mapping.campus,
            grade: mapping.grade,
            spend: 0,
            leads: 0,
            qualifiedLeads: 0,
            wlLeads: 0,
            targetLeads: 0,
            targetQL: 0,
            targetWL: 0,
            monthlyBudget: 0,
          });
        }
        const segment = campusGradeMap.get(key);
        segment.spend += i.spend;
        segment.leads += i.leads;
      }
    });

    // Accumulate CRM statuses
    crmLeads.forEach(lead => {
      if (lead.campus && lead.grade) {
        const key = `${lead.campus}_${lead.grade}`;
        if (campusGradeMap.has(key)) {
          const segment = campusGradeMap.get(key);
          if (['qualified_lead', 'wl', 'enrolled'].includes(lead.leadStatus)) segment.qualifiedLeads++;
          if (['wl', 'enrolled'].includes(lead.leadStatus)) segment.wlLeads++;
        }
      }
    });

    // 3. Compile Campus/Grade performance list
    const campusGradePerformance = Array.from(campusGradeMap.values()).map(seg => {
      const metrics = calculateMetrics({
        spend: seg.spend,
        impressions: 0, reach: 0, clicks: 0, linkClicks: 0,
        leads: seg.leads,
        qualifiedLeads: seg.qualifiedLeads,
        wlLeads: seg.wlLeads
      });

      const achievedLeadsPct = seg.targetLeads > 0 ? (seg.leads / seg.targetLeads) * 100 : 0;
      
      // Calculate Status based on time pacing vs achievement
      const timeRatio = daysPassed / daysInMonth;
      const expectedRatio = timeRatio * 0.85; // Allow 15% slack
      const progressRatio = seg.targetLeads > 0 ? seg.leads / seg.targetLeads : 1;

      let status = 'On track';
      if (progressRatio < expectedRatio * 0.5) status = 'Critical';
      else if (progressRatio < expectedRatio * 0.8) status = 'At risk';
      else if (progressRatio < expectedRatio) status = 'Slightly behind';

      const forecastLeads = (seg.leads / daysPassed) * daysInMonth;

      return {
        campus: seg.campus,
        grade: seg.grade,
        spend: seg.spend,
        leads: seg.leads,
        cpl: metrics.cpl,
        ql: seg.qualifiedLeads,
        cpql: metrics.cpql,
        wl: seg.wlLeads,
        cpwl: metrics.cpwl,
        kpiProgressPct: achievedLeadsPct,
        forecastLeads: Math.round(forecastLeads),
        status,
        monthlyBudget: seg.monthlyBudget,
        targetLeads: seg.targetLeads,
      };
    });

    // 4. Source Breakdown (LeadAds, Messenger, Conversion)
    const sources = ['LeadAds', 'Messenger', 'Conversion'];
    const sourceBreakdown = sources.map(src => {
      const srcLeads = crmLeads.filter(l => l.source === src);
      
      // Calculate spend for source
      let srcSpend = 0;
      insights.forEach(i => {
        // Map campaign naming keywords to source
        const isLeadAds = i.campaignName?.includes('VIDEO') || i.campaignName?.includes('LEADS');
        const isMsg = i.campaignName?.includes('MSG') || i.campaignName?.includes('MESSENGER');
        const mappedSrc = isLeadAds ? 'LeadAds' : isMsg ? 'Messenger' : 'Conversion';
        if (mappedSrc === src) {
          srcSpend += i.spend;
        }
      });

      const leadsCount = srcLeads.length;
      const qlCount = srcLeads.filter(l => ['qualified_lead', 'wl', 'enrolled'].includes(l.leadStatus)).length;
      const wlCount = srcLeads.filter(l => ['wl', 'enrolled'].includes(l.leadStatus)).length;

      const metrics = calculateMetrics({
        spend: srcSpend,
        impressions: 0, reach: 0, clicks: 0, linkClicks: 0,
        leads: leadsCount,
        qualifiedLeads: qlCount,
        wlLeads: wlCount
      });

      return {
        source: src,
        spend: srcSpend,
        leads: leadsCount,
        cpl: metrics.cpl,
        ql: qlCount,
        cpql: metrics.cpql,
        wl: wlCount,
        cpwl: metrics.cpwl,
        leadToQlRate: metrics.leadToQlRate,
        qlToWlRate: metrics.qlToWlRate,
      };
    });

    // 5. Total progress metrics
    let totalTargetLeads = 0;
    let totalTargetQL = 0;
    let totalTargetWL = 0;
    let totalTargetBudget = 0;

    kpiTargets.forEach(k => {
      totalTargetLeads += k.targetLeads;
      totalTargetQL += k.targetQualifiedLeads;
      totalTargetWL += k.targetWl;
      totalTargetBudget += k.monthlyBudget;
    });

    // Fallbacks
    if (totalTargetBudget === 0) totalTargetBudget = 100000000;
    if (totalTargetLeads === 0) totalTargetLeads = 510;
    if (totalTargetQL === 0) totalTargetQL = 185;
    if (totalTargetWL === 0) totalTargetWL = 60;

    const totalSpend = insights.reduce((sum, i) => sum + i.spend, 0);
    const totalLeads = crmLeads.length;
    const totalQL = crmLeads.filter(l => ['qualified_lead', 'wl', 'enrolled'].includes(l.leadStatus)).length;
    const totalWL = crmLeads.filter(l => ['wl', 'enrolled'].includes(l.leadStatus)).length;

    const achievedLeadsPct = (totalLeads / totalTargetLeads) * 100;
    const forecastLeads = Math.round((totalLeads / daysPassed) * daysInMonth);
    const gapToTarget = Math.max(0, totalTargetLeads - totalLeads);
    const requiredDailyLeads = Math.max(0, gapToTarget / remainingDays);
    const budgetRemaining = Math.max(0, totalTargetBudget - totalSpend);

    // 6. Management Recommendations (Next Actions)
    const recommendations = await prisma.recommendation.findMany({
      where: { status: 'pending' },
      orderBy: { date: 'desc' },
      take: 5
    });

    const managementActions = recommendations.map((rec: any) => {
      let impact = 'MEDIUM';
      if (rec.severity === 'high') impact = 'HIGH';
      if (rec.recommendationType === 'CUT') impact = 'HIGH (Save Cost)';
      if (rec.recommendationType === 'SCALE') impact = 'HIGH (Scale Leads)';

      return {
        action: rec.title,
        reason: rec.reason,
        impact,
        owner: rec.assignedTo || 'Unassigned',
        status: rec.status,
        id: rec.id,
      };
    });

    return NextResponse.json({
      kpiProgress: {
        targetLeads: totalTargetLeads,
        actualLeads: totalLeads,
        achievedLeadsPct,
        forecastLeads,
        gapToTarget,
        requiredDailyLeads,
        targetQL: totalTargetQL,
        actualQL: totalQL,
        targetWL: totalTargetWL,
        actualWL: totalWL,
        totalBudget: totalTargetBudget,
        spend: totalSpend,
        budgetRemaining,
      },
      campusGradePerformance,
      sourceBreakdown,
      managementActions,
    });
  } catch (error: any) {
    console.error('Executive API error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
