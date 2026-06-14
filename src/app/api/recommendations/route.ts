import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateRecommendationForObject, DEFAULT_BENCHMARK } from '@/lib/recommendations';
import { cookies } from 'next/headers';

// GET: List all recommendations
export async function GET() {
  try {
    const recommendations = await prisma.recommendation.findMany({
      orderBy: { date: 'desc' }
    });
    return NextResponse.json({ recommendations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Trigger Recommendation Engine to generate alerts
export async function POST() {
  try {
    // 1. Fetch daily insights aggregated by Ad level in the last 30 days
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);

    const insights = await prisma.insightsDaily.findMany({
      where: {
        level: 'ad',
        date: { gte: defaultStart }
      }
    });

    const adIds = Array.from(new Set(insights.map(i => i.adId)));
    const ads = await prisma.ad.findMany({
      where: { adId: { in: adIds } }
    });

    const crmLeads = await prisma.crmLead.findMany({
      where: { leadDate: { gte: defaultStart } }
    });

    // Aggregate stats by adId
    const adMap = new Map();
    insights.forEach(i => {
      if (!adMap.has(i.adId)) {
        adMap.set(i.adId, {
          id: i.adId,
          name: i.adName,
          type: 'ad',
          spend: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          linkClicks: 0,
          leads: 0,
          qualifiedLeads: 0,
          wlLeads: 0,
        });
      }
      const ad = adMap.get(i.adId);
      ad.spend += i.spend;
      ad.impressions += i.impressions;
      ad.reach += i.reach;
      ad.clicks += i.clicks;
      ad.linkClicks += i.linkClicks;
      ad.leads += i.leads;
    });

    // Populate CRM leads
    crmLeads.forEach(lead => {
      if (lead.adId && adMap.has(lead.adId)) {
        const ad = adMap.get(lead.adId);
        if (['qualified_lead', 'wl', 'enrolled'].includes(lead.leadStatus)) ad.qualifiedLeads++;
        if (['wl', 'enrolled'].includes(lead.leadStatus)) ad.wlLeads++;
      }
    });

    let generatedCount = 0;
    const generatedRecommendations = [];

    // Clean pending recommendations to avoid duplicates
    await prisma.recommendation.deleteMany({
      where: { status: 'pending' }
    });

    // 2. Run rule engine for each ad
    for (const adStats of adMap.values()) {
      const rec = generateRecommendationForObject(adStats, DEFAULT_BENCHMARK);
      
      // Store recommendation if it is not HOLD (or store SCALE, CUT, REFRESH, QUALITY, SALES alerts)
      if (rec.recommendationType !== 'HOLD') {
        const saved = await prisma.recommendation.create({
          data: {
            objectId: rec.objectId,
            objectType: rec.objectType,
            recommendationType: rec.recommendationType,
            severity: rec.severity,
            title: rec.title,
            reason: rec.reason,
            evidenceJson: JSON.stringify(rec.evidence),
            status: 'pending',
          }
        });
        generatedRecommendations.push(saved);
        generatedCount++;
      }
    }

    // Write audit log
    let userId = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        userId = JSON.parse(sessionCookie.value).id;
      }
    } catch (_) {}

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'GENERATE_RECOMMENDATIONS',
        entityType: 'RECOMMENDATION',
        entityId: 'ALL',
        afterJson: JSON.stringify({ count: generatedCount }),
      }
    });

    return NextResponse.json({
      success: true,
      message: `Động cơ đề xuất đã quét và tạo mới thành công ${generatedCount} cảnh báo tối ưu hóa.`,
      count: generatedCount,
      data: generatedRecommendations,
    });
  } catch (error: any) {
    console.error('Generate recommendations failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
