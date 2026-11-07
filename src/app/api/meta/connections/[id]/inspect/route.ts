import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaReadOnlySyncService } from '@/lib/sync/metaReadOnlyService';
import { MetaApiError, normalizeAdAccountId } from '@/lib/meta';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Server-verified single-user authentication
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // 2. Fetch connection from DB
    const connection = await prisma.metaConnection.findUnique({
      where: { id },
      include: {
        adAccounts: true,
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'Không tìm thấy kết nối Meta với ID này.' },
        { status: 404 }
      );
    }

    // 3. Parse request body
    let body: {
      adAccountId?: string;
      dateFrom?: string;
      dateTo?: string;
      sampleLimit?: number;
      maxPages?: number;
    } = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // 4. Explicit and validated Ad Account selection (Anti-Ambiguity)
    let targetAdAccountId = body.adAccountId ? normalizeAdAccountId(body.adAccountId) : '';

    if (!targetAdAccountId) {
      const linkedCount = connection.adAccounts?.length || 0;
      if (linkedCount === 1) {
        // Unambiguous: exactly one account linked
        targetAdAccountId = connection.adAccounts[0].accountId;
      } else if (linkedCount === 0) {
        return NextResponse.json(
          {
            error:
              'Thiếu adAccountId. Kết nối này chưa có Ad Account nào được liên kết. Vui lòng cung cấp adAccountId trong request body.',
          },
          { status: 400 }
        );
      } else {
        const availableAccounts = connection.adAccounts
          .map(a => `${a.accountName || a.accountId} (${a.accountId})`)
          .join(', ');
        return NextResponse.json(
          {
            error: `Yêu cầu cung cấp adAccountId cụ thể. Kết nối có ${linkedCount} Ad Accounts liên kết [${availableAccounts}]. Vui lòng chỉ định rõ adAccountId cần kiểm tra để tránh nhầm lẫn.`,
          },
          { status: 400 }
        );
      }
    }

    // 5. Safe Read-Only Inspection (Zero DB mutations, Sanitized tokens)
    const inspectResult = await MetaReadOnlySyncService.inspectAdAccount(connection, {
      adAccountId: targetAdAccountId,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      sampleLimit: body.sampleLimit,
      maxPages: body.maxPages,
    });

    return NextResponse.json({
      success: true,
      connectionId: connection.id,
      connectionName: connection.connectionName,
      ...inspectResult,
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          success: false,
          error: error.userMessage || error.message,
          code: error.code,
          subcode: error.subcode,
          category: error.category,
          retryable: error.category === 'RATE_LIMIT' || error.category === 'NETWORK_ERROR',
        },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định khi kiểm tra dữ liệu Meta';
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
