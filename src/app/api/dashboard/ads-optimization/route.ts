import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateMetrics, safeDivide } from '@/lib/metrics';
import { generateRecommendationForObject, DEFAULT_BENCHMARK } from '@/lib/recommendations';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level') || 'campaign'; // campaign, adset, ad
    const accountId = searchParams.get('accountId') || undefined;
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    const campusFilter = searchParams.get('campus') || undefined;
    const gradeFilter = searchParams.get('grade') || undefined;
    const funnelFilter = searchParams.get('funnel') || undefined;
    const recTypeFilter = searchParams.get('recommendationType') || undefined;

    // Default dates: last 30 days
    const now = new Date();
    const defaultStart = new Date();
    defaultStart.setDate(now.getDate() - 30);
    
    const start = dateFromParam ? new Date(dateFromParam) : defaultStart;
    const end = dateToParam ? new Date(dateToParam) : now;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 1. Fetch daily insights for specified level
    const insights = await prisma.insightsDaily.findMany({
      where: {
        level,
        adAccountId: accountId,
        date: {
          gte: start,
          lte: end,
        }
      }
    });

    // 2. Fetch all structure info and recommendations for join
    const recommendations = await prisma.recommendation.findMany({
      where: { objectType: level }
    });

    const recMap = new Map();
    recommendations.forEach(r => recMap.set(r.objectId, r));

    // Get Content Mappings to filter
    const adIds = Array.from(new Set(insights.map(i => i.adId)));
    const ads = await prisma.ad.findMany({
      where: { adId: { in: adIds } },
      include: { contentMapping: true }
    });

    const adMappingMap = new Map();
    ads.forEach(ad => {
      if (ad.contentMapping) adMappingMap.set(ad.adId, ad.contentMapping);
    });

    // Get CRM leads to aggregate funnel data
    const crmLeads = await prisma.crmLead.findMany({
      where: { leadDate: { gte: start, lte: end } }
    });

    // 3. Aggregate insights by Object ID (campaignId, adsetId, or adId)
    const objectMap = new Map();

    insights.forEach(i => {
      const id = level === 'campaign' ? i.campaignId : level === 'adset' ? i.adsetId : i.adId;
      const name = level === 'campaign' ? i.campaignName : level === 'adset' ? i.adsetName : i.adName;

      // Filter by ContentMapping tags if level is 'ad' or we can map adId
      const mapping = adMappingMap.get(i.adId);
      if (campusFilter && (!mapping || mapping.campus !== campusFilter)) return;
      if (gradeFilter && (!mapping || mapping.grade !== gradeFilter)) return;
      if (funnelFilter && (!mapping || mapping.funnelStage !== funnelFilter)) return;

      if (!objectMap.has(id)) {
        objectMap.set(id, {
          id,
          name,
          spend: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          linkClicks: 0,
          leads: 0,
          landingPageViews: 0,
          rawRecords: [],
        });
      }

      const obj = objectMap.get(id);
      obj.spend += i.spend;
      obj.impressions += i.impressions;
      obj.reach += i.reach;
      obj.clicks += i.clicks;
      obj.linkClicks += i.linkClicks;
      obj.leads += i.leads;
      obj.landingPageViews += i.landingPageViews;
      obj.rawRecords.push(i);
    });

    // Fetch structures (budgets/status) from DB
    const campaigns = level === 'campaign' ? await prisma.campaign.findMany() : [];
    const adsets = level === 'adset' ? await prisma.adSet.findMany() : [];
    const dbAds = level === 'ad' ? await prisma.ad.findMany({ include: { contentMapping: true } }) : [];

    const budgetMap = new Map();
    const statusMap = new Map();

    campaigns.forEach(c => {
      budgetMap.set(c.campaignId, c.dailyBudget || c.lifetimeBudget || 0);
      statusMap.set(c.campaignId, c.effectiveStatus);
    });
    adsets.forEach(as => {
      budgetMap.set(as.adsetId, as.dailyBudget || as.lifetimeBudget || 0);
      statusMap.set(as.adsetId, as.effectiveStatus);
    });
    dbAds.forEach(a => {
      statusMap.set(a.adId, a.effectiveStatus);
    });

    // 4. Build output models with Metrics and Recommendations
    const outputList = [];

    for (const obj of objectMap.values()) {
      // Aggregate CRM values for this specific object
      const objLeads = crmLeads.filter(l => {
        const matchesId = level === 'campaign' ? l.campaignId === obj.id : level === 'adset' ? l.adsetId === obj.id : l.adId === obj.id;
        return matchesId;
      });

      const ql = objLeads.filter(l => ['qualified_lead', 'wl', 'enrolled'].includes(l.leadStatus)).length;
      const wl = objLeads.filter(l => ['wl', 'enrolled'].includes(l.leadStatus)).length;

      const metrics = calculateMetrics({
        spend: obj.spend,
        impressions: obj.impressions,
        reach: obj.reach,
        clicks: obj.clicks,
        linkClicks: obj.linkClicks,
        leads: obj.leads,
        qualifiedLeads: ql,
        wlLeads: wl
      });

      // Budget and Status maps
      const budget = budgetMap.get(obj.id) || 0;
      const status = statusMap.get(obj.id) || 'ACTIVE';

      // 3-Day & 7-Day Spend Trends
      // Sort records by date
      const sortedRecords = [...obj.rawRecords].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      let trend3Days = 0;
      let trend7Days = 0;

      if (sortedRecords.length >= 6) {
        const last3 = sortedRecords.slice(-3).reduce((sum, r) => sum + r.spend, 0);
        const prev3 = sortedRecords.slice(-6, -3).reduce((sum, r) => sum + r.spend, 0);
        trend3Days = (safeDivide(last3 - prev3, prev3) ?? 0) * 100;
      }
      if (sortedRecords.length >= 14) {
        const last7 = sortedRecords.slice(-7).reduce((sum, r) => sum + r.spend, 0);
        const prev7 = sortedRecords.slice(-14, -7).reduce((sum, r) => sum + r.spend, 0);
        trend7Days = (safeDivide(last7 - prev7, prev7) ?? 0) * 100;
      }

      // Generate recommendation programmatically using engine
      const recResult = generateRecommendationForObject({
        id: obj.id,
        name: obj.name,
        type: level as any,
        spend: obj.spend,
        impressions: obj.impressions,
        reach: obj.reach,
        clicks: obj.clicks,
        linkClicks: obj.linkClicks,
        leads: obj.leads,
        qualifiedLeads: ql,
        wlLeads: wl,
        ctrTrend3Days: -5 // Placeholder for fatigue demo
      }, DEFAULT_BENCHMARK);

      // Map to db saved recommendation if exists
      const savedRec = recMap.get(obj.id);
      const activeRec = savedRec ? {
        recommendationType: savedRec.recommendationType,
        severity: savedRec.severity,
        reason: savedRec.reason,
      } : {
        recommendationType: recResult.recommendationType,
        severity: recResult.severity,
        reason: recResult.reason,
      };

      // Filter by recommendation type
      if (recTypeFilter && activeRec.recommendationType !== recTypeFilter) {
        continue;
      }

      outputList.push({
        id: obj.id,
        name: obj.name,
        spend: obj.spend,
        budget,
        leads: obj.leads,
        cpl: metrics.cpl,
        ql,
        cpql: metrics.cpql,
        wl,
        cpwl: metrics.cpwl,
        impressions: obj.impressions,
        reach: obj.reach,
        frequency: metrics.frequency,
        ctr: metrics.ctr,
        cpc: metrics.cpc,
        cpm: metrics.cpm,
        landingPageViews: obj.landingPageViews,
        costPerLandingPageView: safeDivide(obj.spend, obj.landingPageViews, null),
        trend3Days,
        trend7Days,
        status,
        recommendation: activeRec.recommendationType,
        recommendationSeverity: activeRec.severity,
        recommendationReason: activeRec.reason,
        contentMapping: adMappingMap.get(level === 'ad' ? obj.id : undefined) || null,
        lastUpdated: sortedRecords.length > 0 ? sortedRecords[sortedRecords.length - 1].date : new Date(),
      });
    }

    return NextResponse.json({ data: outputList });
  } catch (error: any) {
    console.error('Ads Optimization API error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
