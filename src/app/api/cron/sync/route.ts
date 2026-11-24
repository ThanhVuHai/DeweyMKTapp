import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { MetaSyncEngine, ENABLED_ACCOUNTS_FOR_SYNC } from '@/lib/sync/metaSyncEngine';
import { isMockToken, MetaApiService } from '@/lib/meta';

export const maxDuration = 60; // Max serverless function timeout

/**
 * Scheduled Meta Ads Daily Synchronization Endpoint
 * Triggered by Vercel Cron Jobs (0 2 * * *) or an authorized external scheduler.
 * Fail-closed authentication using CRON_SECRET.
 */
async function handleScheduledSync(request: Request) {
  try {
    // 1. Verify CRON_SECRET
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[CRON ERROR]: CRON_SECRET environment variable is not configured.');
      return NextResponse.json(
        {
          success: false,
          error: 'CRON_SECRET chưa được cấu hình trong Environment Variables.',
        },
        { status: 401 }
      );
    }

    const expectedHeader = `Bearer ${cronSecret}`;
    if (!authHeader || authHeader !== expectedHeader) {
      console.warn('[CRON UNAUTHORIZED]: Invalid or missing authorization header.');
      return NextResponse.json(
        {
          success: false,
          error: 'Truy cập không hợp lệ: Yêu cầu Authorization Bearer header chứa CRON_SECRET chính xác.',
        },
        { status: 401 }
      );
    }

    // 2. Resolve Active Connection
    const connection = await prisma.metaConnection.findFirst({
      where: { status: 'connected' },
      include: { adAccounts: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!connection) {
      return NextResponse.json(
        {
          success: false,
          message: 'Không tìm thấy kết nối Meta nào ở trạng thái "connected" để chạy cron sync.',
        },
        { status: 200 }
      );
    }

    // Guard: Prevent running real cron with mock demo tokens
    const decryptedToken = MetaApiService.getDecryptedToken(connection);
    if (isMockToken(decryptedToken) && process.env.NODE_ENV !== 'test') {
      return NextResponse.json(
        {
          success: false,
          message: 'Kết nối hiện tại dùng Token Demo (MOCK). Bỏ qua tác vụ đồng bộ tự động.',
        },
        { status: 200 }
      );
    }

    // 3. Historical Lookback Window (Default: Last 7 days to capture delayed conversions)
    const now = new Date();
    const dateTo = now.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dateFrom = sevenDaysAgo.toISOString().split('T')[0];

    // 4. Target Enabled Accounts (Strict Scope: GIS Hà Nội only)
    const targetAccountId = 'act_1380498158917028';
    if (!ENABLED_ACCOUNTS_FOR_SYNC.includes(targetAccountId)) {
      return NextResponse.json(
        {
          success: false,
          message: `Tài khoản ${targetAccountId} không nằm trong danh sách được cấp phép sync.`,
        },
        { status: 200 }
      );
    }

    // 5. Execute Sync
    const syncResult = await MetaSyncEngine.syncAdAccount(connection, {
      adAccountId: targetAccountId,
      dateFrom,
      dateTo,
      jobType: 'scheduled_cron',
    });

    return NextResponse.json({
      success: true,
      message: 'Đồng bộ tự động theo lịch (Scheduled Cron Sync) hoàn tất thành công!',
      timestamp: new Date().toISOString(),
      execution: syncResult,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown cron error';
    console.error('[CRON SYNC FAILED]:', error);
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleScheduledSync(request);
}

export async function POST(request: Request) {
  return handleScheduledSync(request);
}
