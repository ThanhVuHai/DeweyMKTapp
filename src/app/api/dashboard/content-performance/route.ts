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

    // 1. Fetch daily insights at AD level
    const insights = await prisma.insightsDaily.findMany({
      where: {
        level: 'ad',
        date: { gte: start, lte: end }
      }
    });

    const adIds = Array.from(new Set(insights.map(i => i.adId)));
    
    // Fetch Ads and their Content Mappings
    const ads = await prisma.ad.findMany({
      where: { adId: { in: adIds } },
      include: { contentMapping: true }
    });

    const adMappingMap = new Map();
    ads.forEach(ad => {
      if (ad.contentMapping) adMappingMap.set(ad.adId, ad.contentMapping);
    });

    // Fetch CRM leads to compute Lead -> QL
    const crmLeads = await prisma.crmLead.findMany({
      where: { leadDate: { gte: start, lte: end } }
    });

    // Helper functions for grouping
    const groupInsights = (getKey: (mapping: any, i: any) => string | null) => {
      const groupMap = new Map();

      insights.forEach(i => {
        const mapping = adMappingMap.get(i.adId);
        const key = getKey(mapping, i);
        if (!key) return; // skip if no key could be parsed

        if (!groupMap.has(key)) {
          groupMap.set(key, {
            key,
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            linkClicks: 0,
            leads: 0,
            qualifiedLeads: 0,
            wlLeads: 0,
            extra: mapping || {}, // hold mapping tags
          });
        }

        const group = groupMap.get(key);
        group.spend += i.spend;
        group.impressions += i.impressions;
        group.reach += i.reach;
        group.clicks += i.clicks;
        group.linkClicks += i.linkClicks;
        group.leads += i.leads;
      });

      // Calculate CRM Leads mapping to this group
      crmLeads.forEach(lead => {
        let matched = false;
        // Check mapping logic based on grouping keys
        const mapping = ads.find(a => a.adId === lead.adId)?.contentMapping;
        if (mapping) {
          const groupKey = getKey(mapping, { campaignName: lead.campaignId }); // pass mock-object
          if (groupKey && groupMap.has(groupKey)) {
            const group = groupMap.get(groupKey);
            // Verify if lead matches the specific content mapping
            if (
              (groupKey === mapping.contentId) ||
              (groupKey === mapping.funnelStage) ||
              (groupKey === mapping.angle) ||
              (groupKey === mapping.hookType) ||
              (groupKey === mapping.format)
            ) {
              matched = true;
            }
            if (matched) {
              if (['qualified_lead', 'wl', 'enrolled'].includes(lead.leadStatus)) group.qualifiedLeads++;
              if (['wl', 'enrolled'].includes(lead.leadStatus)) group.wlLeads++;
            }
          }
        }
      });

      return Array.from(groupMap.values()).map(g => {
        const metrics = calculateMetrics({
          spend: g.spend,
          impressions: g.impressions,
          reach: g.reach,
          clicks: g.clicks,
          linkClicks: g.linkClicks,
          leads: g.leads,
          qualifiedLeads: g.qualifiedLeads,
          wlLeads: g.wlLeads
        });

        return {
          name: g.key,
          spend: g.spend,
          impressions: g.impressions,
          leads: g.leads,
          cpl: metrics.cpl,
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          cpm: metrics.cpm,
          frequency: metrics.frequency,
          ql: g.qualifiedLeads,
          cpql: metrics.cpql,
          wl: g.wlLeads,
          cpwl: metrics.cpwl,
          leadToQlRate: metrics.leadToQlRate,
          qlToWlRate: metrics.qlToWlRate,
          status: g.extra.contentStatus || 'testing',
          note: g.extra.note || '',
        };
      });
    };

    const byContent = groupInsights((m) => m?.contentId || null);
    const byFunnel = groupInsights((m) => m?.funnelStage || null);
    const byAngle = groupInsights((m) => m?.angle || null);
    const byHookType = groupInsights((m) => m?.hookType || null);
    const byFormat = groupInsights((m) => m?.format || null);

    // Build library library (Win, Fail, Test library view)
    const winFailLibrary = byContent.map(c => {
      let rating = 'TEST';
      if (c.status === 'win' || c.status === 'scale') rating = 'WIN';
      if (c.status === 'fail' || c.status === 'archived') rating = 'FAIL';

      return {
        contentId: c.name,
        spend: c.spend,
        leads: c.leads,
        cpl: c.cpl,
        ctr: c.ctr,
        ql: c.ql,
        leadToQlRate: c.leadToQlRate,
        status: c.status,
        rating,
        note: c.note,
      };
    });

    // Proactive text insights Generation
    const textInsights = [];
    
    // Evaluate Hook type CTR
    const topHook = [...byHookType].sort((a, b) => b.ctr - a.ctr)[0];
    if (topHook) {
      textInsights.push(`Nhóm hook dạng "${topHook.name}" có tỷ lệ CTR cao nhất đạt ${topHook.ctr.toFixed(2)}%, vượt qua CTR trung bình.`);
    }

    // Evaluate Win CPL vs overall
    const winItems = byContent.filter(c => c.status === 'win');
    if (winItems.length > 0) {
      const bestWin = winItems.sort((a, b) => (a.cpl || 999999) - (b.cpl || 999999))[0];
      textInsights.push(`Content mẫu "${bestWin.name}" hoạt động hiệu quả nhất với nhãn WIN, CPL đạt ${bestWin.cpl ? bestWin.cpl.toLocaleString('vi-VN') + 'đ' : 'N/A'}.`);
    }

    // High cost but low quality check
    const badQuality = byContent.find(c => c.leads > 10 && c.leadToQlRate < 15);
    if (badQuality) {
      textInsights.push(`Cảnh báo: Nhóm content "${badQuality.name}" tạo lượng Lead lớn (${badQuality.leads}) nhưng tỷ lệ QL chuyển đổi cực thấp (${badQuality.leadToQlRate.toFixed(1)}%). Cần rà soát lại tệp khách hàng nhắm mục tiêu.`);
    }

    return NextResponse.json({
      byContent,
      byFunnel,
      byAngle,
      byHookType,
      byFormat,
      winFailLibrary,
      textInsights,
    });
  } catch (error: any) {
    console.error('Content Performance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
