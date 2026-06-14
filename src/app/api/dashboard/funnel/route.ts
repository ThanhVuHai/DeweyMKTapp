import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { safeDivide } from '@/lib/metrics';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
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

    // 1. Fetch daily insights at AD level
    const insights = await prisma.insightsDaily.findMany({
      where: {
        level: 'ad',
        date: { gte: start, lte: end }
      }
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

    // 2. Fetch CRM Leads
    const crmLeads = await prisma.crmLead.findMany({
      where: {
        leadDate: { gte: start, lte: end }
      }
    });

    // 3. Filter and aggregate
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalLPV = 0;
    let totalLeads = 0;

    insights.forEach(i => {
      const mapping = adMappingMap.get(i.adId);
      if (campusFilter && (!mapping || mapping.campus !== campusFilter)) return;
      if (gradeFilter && (!mapping || mapping.grade !== gradeFilter)) return;

      totalImpressions += i.impressions;
      totalClicks += i.clicks;
      totalLPV += i.landingPageViews;
      totalLeads += i.leads;
    });

    const matchedLeads = crmLeads.filter(lead => {
      if (campusFilter && lead.campus !== campusFilter) return false;
      if (gradeFilter && lead.grade !== gradeFilter) return false;
      if (sourceFilter && lead.source !== sourceFilter) return false;
      return true;
    });

    const totalQL = matchedLeads.filter(l => ['qualified_lead', 'wl', 'enrolled'].includes(l.leadStatus)).length;
    const totalWL = matchedLeads.filter(l => ['wl', 'enrolled'].includes(l.leadStatus)).length;
    const totalEnroll = matchedLeads.filter(l => l.leadStatus === 'enrolled').length;

    // 4. Calculate Stage Conversion Rates
    const ctr = (safeDivide(totalClicks, totalImpressions) || 0) * 100;
    const lpvRate = (safeDivide(totalLPV, totalClicks) || 0) * 100;
    const clickToLeadRate = (safeDivide(totalLeads, totalClicks) || 0) * 100;
    const leadToQlRate = (safeDivide(totalQL, totalLeads) || 0) * 100;
    const qlToWlRate = (safeDivide(totalWL, totalQL) || 0) * 100;
    const wlToEnrollRate = (safeDivide(totalEnroll, totalWL) || 0) * 100;

    // 5. Generate Troubleshooting Diagnostics
    const diagnostics = [];

    if (totalImpressions > 0 && ctr < 1.0) {
      diagnostics.push({
        stage: 'Impression → Click',
        status: 'warning',
        metric: `CTR: ${ctr.toFixed(2)}%`,
        benchmark: '1.0% - 1.5%',
        message: 'Tỷ lệ nhấp chuột (CTR) thấp. Vấn đề có thể nằm ở Hook tiêu đề, hình ảnh/video Creative chưa đủ hấp dẫn hoặc Placements phân phối chưa tốt. Hãy thử nghiệm thêm các concept sáng tạo mới.',
      });
    } else {
      diagnostics.push({
        stage: 'Impression → Click',
        status: 'success',
        metric: `CTR: ${ctr.toFixed(2)}%`,
        benchmark: '1.0%',
        message: 'Tỷ lệ nhấp chuột tốt. Quảng cáo thu hút người xem thành công.',
      });
    }

    if (totalClicks > 0 && lpvRate < 60) {
      diagnostics.push({
        stage: 'Click → Landing Page View',
        status: 'error',
        metric: `Tỷ lệ tải: ${lpvRate.toFixed(1)}%`,
        benchmark: '60% - 80%',
        message: 'Rơi rụng nhiều khi tải trang. Hãy tối ưu hóa tốc độ tải trang Landing Page, giảm bớt dung lượng ảnh/script và kiểm tra lỗi link.',
      });
    }

    if (totalClicks > 0 && clickToLeadRate < 2.0) {
      diagnostics.push({
        stage: 'Click → Lead',
        status: 'warning',
        metric: `Click → Lead: ${clickToLeadRate.toFixed(2)}%`,
        benchmark: '2.5% - 5.0%',
        message: 'Người dùng click nhiều nhưng không đăng ký Form. Hãy kiểm tra xem biểu mẫu đăng ký có quá dài không, hoặc quà tặng/ưu đãi (Offer) đã đủ hấp dẫn chưa.',
      });
    }

    if (totalLeads > 0 && leadToQlRate < 30) {
      diagnostics.push({
        stage: 'Lead → QL',
        status: 'error',
        metric: `Tỷ lệ QL: ${leadToQlRate.toFixed(1)}%`,
        benchmark: '30%',
        message: 'Lượng Lead tốt nhưng chất lượng kém. Quảng cáo đang truyền tải thông điệp lệch (Content Promise mismatch) hoặc Target đối tượng chưa đúng nhóm thu nhập/nhu cầu. Cần tinh chỉnh tệp và nội dung quảng cáo.',
      });
    } else if (totalLeads > 0) {
      diagnostics.push({
        stage: 'Lead → QL',
        status: 'success',
        metric: `Tỷ lệ QL: ${leadToQlRate.toFixed(1)}%`,
        benchmark: '30%',
        message: 'Chất lượng Lead rất tốt. Tệp khách hàng thu về có nhu cầu thực tế cao.',
      });
    }

    if (totalQL > 0 && qlToWlRate < 20) {
      diagnostics.push({
        stage: 'QL → WL',
        status: 'warning',
        metric: `Tỷ lệ WL: ${qlToWlRate.toFixed(1)}%`,
        benchmark: '20%',
        message: 'Lead chất lượng cao nhưng không đăng ký Waiting List (WL). Cần xem xét lại tốc độ liên hệ của Sales/Tư vấn, kịch bản tư vấn hoặc xử lý các rào cản học phí (Objections).',
      });
    }

    const funnelStages = [
      { name: 'Impressions', value: totalImpressions, rate: 100 },
      { name: 'Clicks', value: totalClicks, rate: ctr },
      { name: 'Landing Page Views', value: totalLPV, rate: lpvRate },
      { name: 'Leads', value: totalLeads, rate: clickToLeadRate },
      { name: 'Qualified Leads', value: totalQL, rate: leadToQlRate },
      { name: 'Waiting List', value: totalWL, rate: qlToWlRate },
      { name: 'Enrollment', value: totalEnroll, rate: wlToEnrollRate },
    ];

    return NextResponse.json({
      funnelStages,
      diagnostics,
    });
  } catch (error: any) {
    console.error('Funnel API error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
