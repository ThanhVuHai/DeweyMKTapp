import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import { MetaReadOnlySyncService } from '@/lib/sync/metaReadOnlyService';
import { MetaApiError } from '@/lib/meta';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Session authentication
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session');
    if (!sessionCookie || !sessionCookie.value) {
      return NextResponse.json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' }, { status: 401 });
    }

    let currentUser: { id?: string; email?: string; role?: string } = {};
    try {
      currentUser = JSON.parse(sessionCookie.value);
    } catch {
      return NextResponse.json({ error: 'Phiên đăng nhập không hợp lệ.' }, { status: 401 });
    }

    // 2. Fetch connection from DB
    const connection = await prisma.metaConnection.findUnique({
      where: { id },
      include: {
        adAccounts: true,
      },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Không tìm thấy kết nối Meta với ID này.' }, { status: 404 });
    }

    // 3. Authorization check (only owner or admin/manager)
    if (
      connection.userId &&
      currentUser.role !== 'admin' &&
      currentUser.role !== 'manager' &&
      connection.userId !== currentUser.id
    ) {
      return NextResponse.json(
        { error: 'Bạn không có quyền truy cập kết nối Meta này.' },
        { status: 403 }
      );
    }

    // 4. Parse request body
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
      // Body is optional if adAccountId can be inferred from linked ad accounts
      body = {};
    }

    // Determine target Ad Account ID
    let adAccountId = body.adAccountId;
    if (!adAccountId) {
      if (connection.adAccounts && connection.adAccounts.length > 0) {
        adAccountId = connection.adAccounts[0].accountId;
      }
    }

    if (!adAccountId) {
      return NextResponse.json(
        {
          error:
            'Thiếu adAccountId. Vui lòng cung cấp adAccountId trong request body hoặc liên kết Ad Account trước.',
        },
        { status: 400 }
      );
    }

    // 5. Execute safe, read-only inspection (Zero database writes)
    const inspectResult = await MetaReadOnlySyncService.inspectAdAccount(connection, {
      adAccountId,
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
