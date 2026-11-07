import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';
import { MetaReadOnlySyncService } from '@/lib/sync/metaReadOnlyService';
import { MetaApiError, normalizeAdAccountId } from '@/lib/meta';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Fetch connection from DB first to verify target existence
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

    // 2. Authentication & Authorization resolution:
    // Support session cookie (if logged in via /api/auth/login),
    // request headers (for programmatic/internal callers),
    // and fallback to internal user identity (standard for internal dashboard single-tenant model).
    let currentUser: { id: string; email?: string; role: string } | null = null;

    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie?.value) {
        const parsed = JSON.parse(sessionCookie.value) as { id?: string; email?: string; role?: string };
        if (parsed.id) {
          currentUser = {
            id: parsed.id,
            email: parsed.email,
            role: parsed.role || 'viewer',
          };
        }
      }
    } catch {
      // Session parsing error ignored; fallback mechanism engages
    }

    // Check request header overrides if session cookie is absent
    if (!currentUser) {
      const headerRole = request.headers.get('x-user-role');
      const headerUserId = request.headers.get('x-user-id');
      if (headerRole) {
        currentUser = {
          id: headerUserId || 'header-user',
          role: headerRole,
        };
      }
    }

    // Fallback: Resolve to internal database user (aligning with POST /api/meta/connections)
    if (!currentUser) {
      try {
        const fallbackUser = await prisma.user.findFirst();
        if (fallbackUser) {
          currentUser = {
            id: fallbackUser.id,
            email: fallbackUser.email,
            role: fallbackUser.role,
          };
        }
      } catch {
        // DB user lookup failed, assign default operator identity
      }
    }

    // Default to admin role for internal environment if no user record exists
    if (!currentUser) {
      currentUser = {
        id: 'default-operator-id',
        role: 'admin',
      };
    }

    // 3. RBAC & Ownership Authorization Checks
    // Check permission: Only 'admin', 'manager', or 'ads_specialist' can inspect Meta API data
    const allowedRoles = ['admin', 'manager', 'ads_specialist'];
    if (!allowedRoles.includes(currentUser.role)) {
      return NextResponse.json(
        {
          error: `Vai trò '${currentUser.role}' không có quyền kiểm tra kết nối Meta API. Yêu cầu quyền admin, manager hoặc ads_specialist.`,
        },
        { status: 403 }
      );
    }

    // Ownership check: If connection is bound to a specific user and caller is not admin/manager
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
      // Body is optional
      body = {};
    }

    // 5. Anti-Ambiguity Ad Account Selection & Authorization
    let targetAdAccountId = body.adAccountId ? normalizeAdAccountId(body.adAccountId) : '';

    if (!targetAdAccountId) {
      // Disallow silent arbitrary selection when ambiguous
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
        const availableAccounts = connection.adAccounts.map(a => `${a.accountName || a.accountId} (${a.accountId})`).join(', ');
        return NextResponse.json(
          {
            error: `Yêu cầu cung cấp adAccountId cụ thể. Kết nối có ${linkedCount} Ad Accounts liên kết [${availableAccounts}]. Vui lòng chỉ định rõ adAccountId cần kiểm tra để tránh nhầm lẫn.`,
          },
          { status: 400 }
        );
      }
    }

    // Verify authorized scope: If connection already has linked accounts, ensure targetAdAccountId is authorized
    if (connection.adAccounts && connection.adAccounts.length > 0) {
      const isLinked = connection.adAccounts.some(
        acc => acc.accountId === targetAdAccountId || normalizeAdAccountId(acc.accountId) === targetAdAccountId
      );
      if (!isLinked && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
        return NextResponse.json(
          {
            error: `Ad Account '${targetAdAccountId}' không nằm trong danh sách tài khoản được ủy quyền cho kết nối này.`,
          },
          { status: 403 }
        );
      }
    }

    // 6. Safe Read-Only Inspection (Zero DB mutations, Sanitized tokens)
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
