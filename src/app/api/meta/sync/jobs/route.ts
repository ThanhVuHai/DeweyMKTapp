import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaSyncEngine } from '@/lib/sync/metaSyncEngine';

export const dynamic = 'force-dynamic';

// GET: Fetch recent sync jobs and execution history (with auto-recovery of stale jobs)
export async function GET(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);
    const adAccountId = searchParams.get('adAccountId');

    // 1. Auto-recover any stale RUNNING jobs whose lease has expired
    await MetaSyncEngine.recoverStaleJobs(adAccountId || undefined);

    const whereClause: { adAccountId?: string } = {};
    if (adAccountId) {
      whereClause.adAccountId = adAccountId;
    }

    const jobs = await prisma.syncJob.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        metaConnection: {
          select: {
            connectionName: true,
            status: true,
          },
        },
      },
    });

    // Also get last successful sync and record counts for GIS Hà Nội
    const targetAccountId = 'act_1380498158917028';
    const lastSuccessJob = await prisma.syncJob.findFirst({
      where: {
        adAccountId: targetAccountId,
        status: 'success',
      },
      orderBy: { finishedAt: 'desc' },
    });

    const [campaignCount, adsetCount, adCount, insightsCount] = await Promise.all([
      prisma.campaign.count({
        where: { adAccount: { accountId: targetAccountId } },
      }),
      prisma.adSet.count({
        where: { adAccount: { accountId: targetAccountId } },
      }),
      prisma.ad.count({
        where: { adAccount: { accountId: targetAccountId } },
      }),
      prisma.insightsDaily.count({
        where: { adAccount: { accountId: targetAccountId } },
      }),
    ]);

    // Aggregate spend, impressions, clicks stored in Neon for GIS Hà Nội
    const aggregates = await prisma.insightsDaily.aggregate({
      where: { adAccount: { accountId: targetAccountId } },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
      },
    });

    return NextResponse.json({
      success: true,
      jobs,
      summary: {
        targetAccountId,
        lastSuccessfulSync: lastSuccessJob?.finishedAt || null,
        persistedCounts: {
          campaigns: campaignCount,
          adsets: adsetCount,
          ads: adCount,
          insightsDaily: insightsCount,
        },
        persistedMetrics: {
          totalSpend: Math.round(aggregates._sum.spend || 0),
          totalImpressions: aggregates._sum.impressions || 0,
          totalClicks: aggregates._sum.clicks || 0,
        },
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

// POST: Explicitly trigger stale job recovery and unlock accounts
export async function POST(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const recoveryResult = await MetaSyncEngine.recoverStaleJobs(body.adAccountId);

    return NextResponse.json({
      success: true,
      message: `Đã kiểm tra và thu hồi ${recoveryResult.recoveredCount} tiến trình quá hạn.`,
      data: recoveryResult,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
