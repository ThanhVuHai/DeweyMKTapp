import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateMetrics, calculatePacing, calculateForecast } from '@/lib/metrics';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId') || undefined;
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    const campusFilter = searchParams.get('campus') || undefined;
    const gradeFilter = searchParams.get('grade') || undefined;
    const sourceFilter = searchParams.get('source') || undefined;

    // Default dates: last 30 days
    const now = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(now.getDate() - 30);
    
    const start = dateFromParam ? new Date(dateFromParam) : defaultStart;
    const end = dateToParam ? new Date(dateToParam) : now;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 1. Fetch daily insights at AD level to allow content mapping filters
    const insights = await prisma.insightsDaily.findMany({
      where: {
        level: 'ad',
        adAccountId: accountId,
        date: {
          gte: start,
          lte: end,
        }
      }
    });

    // 2. Fetch Content Mappings and CRM Leads to join in memory
    const adIds = Array.from(new Set(insights.map(i => i.adId)));
    const ads = await prisma.ad.findMany({
      where: { adId: { in: adIds } },
      include: { contentMapping: true }
    });

    const adMappingMap = new Map();
    ads.forEach(ad => {
      if (ad.contentMapping) {
        adMappingMap.set(ad.adId, ad.contentMapping);
      }
    });

    // Fetch CRM Leads in the date range
    const crmLeads = await prisma.crmLead.findMany({
      where: {
        leadDate: {
          gte: start,
          lte: end,
        },
        campaignId: accountId ? undefined : undefined, // simplify filters
      }
    });

    // Filter insights based on Content Mapping
    const filteredInsights = insights.filter(i => {
      const mapping = adMappingMap.get(i.adId);
      if (campusFilter && (!mapping || mapping.campus !== campusFilter)) return false;
      if (gradeFilter && (!mapping || mapping.grade !== gradeFilter)) return false;
      if (sourceFilter) {
        // Source mapping: LeadAds objective or Conversion
        const isLeadAds = i.campaignName?.includes('VIDEO') || i.campaignName?.includes('LEADS');
        const sourceMatch = sourceFilter === 'LeadAds' ? isLeadAds : !isLeadAds;
        if (!sourceMatch) return false;
      }
      return true;
    });

    // If database is completely empty and no insights, return instructions/empty state
    if (insights.length === 0) {
      return NextResponse.json({
        isEmpty: true,
        message: 'No data found. Please run connections setup and sync or click Seed Demo Data.'
      });
    }

    // 3. Aggregate performance numbers
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalReach = 0;
    let totalClicks = 0;
    let totalLinkClicks = 0;
    let totalLeads = 0;

    filteredInsights.forEach(i => {
      totalSpend += i.spend;
      totalImpressions += i.impressions;
      totalReach += i.reach;
      totalClicks += i.clicks;
      totalLinkClicks += i.linkClicks;
      totalLeads += i.leads;
    });

    // Aggregate CRM Leads numbers matching filters
    const matchedLeads = crmLeads.filter(lead => {
      if (campusFilter && lead.campus !== campusFilter) return false;
      if (gradeFilter && lead.grade !== gradeFilter) return false;
      if (sourceFilter && lead.source !== sourceFilter) return false;
      return true;
    });

    const totalQL = matchedLeads.filter(l => ['qualified_lead', 'wl', 'enrolled'].includes(l.leadStatus)).length;
    const totalWL = matchedLeads.filter(l => ['wl', 'enrolled'].includes(l.leadStatus)).length;
    const totalEnrolled = matchedLeads.filter(l => l.leadStatus === 'enrolled').length;

    // Calculate core marketing metrics
    const coreMetrics = calculateMetrics({
      spend: totalSpend,
      impressions: totalImpressions,
      reach: totalReach,
      clicks: totalClicks,
      linkClicks: totalLinkClicks,
      leads: totalLeads,
      qualifiedLeads: totalQL,
      wlLeads: totalWL
    });

    // 4. Budget Pacing & KPI Progress
    // Calculate days passed in month
    const currentMonth = end.getMonth() + 1;
    const currentYear = end.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysPassed = end.getDate();

    // Query KPI Targets matching filters
    const kpiTargets = await prisma.kpiTarget.findMany({
      where: {
        month: currentMonth,
        year: currentYear,
        campus: campusFilter,
        grade: gradeFilter,
        source: sourceFilter,
      }
    });

    let targetLeads = 0;
    let targetQL = 0;
    let targetWL = 0;
    let targetBudget = 0;

    kpiTargets.forEach(k => {
      targetLeads += k.targetLeads;
      targetQL += k.targetQualifiedLeads;
      targetWL += k.targetWl;
      targetBudget += k.monthlyBudget;
    });

    // Apply default fallbacks for KPIs if none set
    if (targetBudget === 0) targetBudget = 50000000; // 50M default fallback
    if (targetLeads === 0) targetLeads = 150;

    const pacing = calculatePacing(totalSpend, targetBudget, daysPassed, daysInMonth);

    // Calculate run-rate forecasts
    const forecastLeads = calculateForecast(totalLeads, daysPassed, daysInMonth);
    const forecastQL = calculateForecast(totalQL, daysPassed, daysInMonth);
    const forecastWL = calculateForecast(totalWL, daysPassed, daysInMonth);

    // 5. Build daily trends data (group by date)
    const dailyDataMap = new Map();
    filteredInsights.forEach(i => {
      const dateStr = i.date.toISOString().split('T')[0];
      if (!dailyDataMap.has(dateStr)) {
        dailyDataMap.set(dateStr, {
          date: dateStr,
          spend: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
        });
      }
      const day = dailyDataMap.get(dateStr);
      day.spend += i.spend;
      day.impressions += i.impressions;
      day.clicks += i.clicks;
      day.leads += i.leads;
    });

    const dailyTrends = Array.from(dailyDataMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        cpl: d.leads > 0 ? Math.round(d.spend / d.leads) : 0,
        ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
        cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
      }));

    // 6. Top Performance Lists
    // Group by Campaign Name
    const campaignMap = new Map();
    filteredInsights.forEach(i => {
      if (!campaignMap.has(i.campaignId)) {
        campaignMap.set(i.campaignId, {
          id: i.campaignId,
          name: i.campaignName,
          spend: 0,
          leads: 0,
          clicks: 0,
          impressions: 0,
        });
      }
      const camp = campaignMap.get(i.campaignId);
      camp.spend += i.spend;
      camp.leads += i.leads;
      camp.clicks += i.clicks;
      camp.impressions += i.impressions;
    });

    const campaignsList = Array.from(campaignMap.values()).map(c => ({
      ...c,
      cpl: c.leads > 0 ? Math.round(c.spend / c.leads) : null,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    }));

    const topCampaignsByLeads = [...campaignsList]
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10);

    const topCampaignsByCpl = [...campaignsList]
      .filter(c => c.leads > 0)
      .sort((a, b) => (a.cpl || 0) - (b.cpl || 0))
      .slice(0, 10);

    const worstCampaignsByCpl = [...campaignsList]
      .filter(c => c.leads > 0)
      .sort((a, b) => (b.cpl || 0) - (a.cpl || 0))
      .slice(0, 10);

    // Group by Ad Name for Top CTR
    const adGroupMap = new Map();
    filteredInsights.forEach(i => {
      if (!adGroupMap.has(i.adId)) {
        adGroupMap.set(i.adId, {
          id: i.adId,
          name: i.adName,
          clicks: 0,
          impressions: 0,
          spend: 0,
          leads: 0,
        });
      }
      const ad = adGroupMap.get(i.adId);
      ad.clicks += i.clicks;
      ad.impressions += i.impressions;
      ad.spend += i.spend;
      ad.leads += i.leads;
    });

    const adsList = Array.from(adGroupMap.values()).map(ad => ({
      ...ad,
      ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
      cpl: ad.leads > 0 ? Math.round(ad.spend / ad.leads) : null,
    }));

    const topAdsByCtr = [...adsList]
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 10);

    const worstAdsReview = [...adsList]
      .filter(ad => ad.spend > 500000 && (ad.leads === 0 || (ad.cpl && ad.cpl > 500000)))
      .slice(0, 10);

    return NextResponse.json({
      isEmpty: false,
      summary: {
        spend: totalSpend,
        impressions: totalImpressions,
        reach: totalReach,
        leads: totalLeads,
        qualifiedLeads: totalQL,
        wlLeads: totalWL,
        enrolledLeads: totalEnrolled,
        ...coreMetrics,
        budgetUsedPct: pacing.budgetUsedPct,
        timePassedPct: pacing.timePassedPct,
        pacingGap: pacing.pacingGap,
        targetBudget,
        targetLeads,
        targetQL,
        targetWL,
        forecastLeads,
        forecastQL,
        forecastWL,
      },
      dailyTrends,
      topCampaignsByLeads,
      topCampaignsByCpl,
      worstCampaignsByCpl,
      topAdsByCtr,
      worstAdsReview,
    });
  } catch (error: unknown) {
    console.error('Overview API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error: ' + message },
      { status: 500 }
    );
  }
}
