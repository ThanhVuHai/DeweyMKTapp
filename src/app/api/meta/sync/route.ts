import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaSyncEngine, ENABLED_ACCOUNTS_FOR_SYNC } from '@/lib/sync/metaSyncEngine';
import { normalizeAdAccountId, MetaApiError } from '@/lib/meta';

// POST: Execute Manual Meta Ads Synchronization
export async function POST(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại để thực hiện đồng bộ dữ liệu.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { adAccountId, dateFrom, dateTo, connectionId, force = false } = body;

    const targetAccountId = adAccountId ? normalizeAdAccountId(adAccountId) : 'act_1380498158917028';

    // Verify account enablement scope
    if (!ENABLED_ACCOUNTS_FOR_SYNC.includes(targetAccountId)) {
      return NextResponse.json(
        {
          error: `Tài khoản ${targetAccountId} chưa được cấp phép đồng bộ. Chỉ tài khoản GIS Hà Nội (act_1380498158917028) được kích hoạt.`,
        },
        { status: 400 }
      );
    }

    // Resolve MetaConnection
    let connection = null;
    if (connectionId) {
      connection = await prisma.metaConnection.findUnique({ where: { id: connectionId } });
    } else {
      connection = await prisma.metaConnection.findFirst({
        where: {
          adAccounts: {
            some: {
              accountId: targetAccountId,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!connection) {
      // Fallback to most recent connection
      connection = await prisma.metaConnection.findFirst({
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!connection) {
      return NextResponse.json(
        { error: 'Không tìm thấy kết nối Meta API nào. Vui lòng cấu hình kết nối trước.' },
        { status: 404 }
      );
    }

    const syncResult = await MetaSyncEngine.syncAdAccount(connection, {
      adAccountId: targetAccountId,
      dateFrom,
      dateTo,
      jobType: 'manual_sync',
      force,
    });

    return NextResponse.json({
      success: true,
      message: `Đồng bộ dữ liệu Meta thành công cho tài khoản ${syncResult.accountName}!`,
      data: syncResult,
    });
  } catch (error: unknown) {
    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          success: false,
          error: error.userMessage || error.message,
          code: error.code,
          category: error.category,
          technicalDetails: error.technicalDetails,
        },
        { status: 400 }
      );
    }

    const errorMsg = error instanceof Error ? error.message : 'Unknown synchronization error';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
