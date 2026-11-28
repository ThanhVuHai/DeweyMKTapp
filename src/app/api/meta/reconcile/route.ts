import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { ReconciliationEngine } from '@/lib/sync/reconciliationEngine';
import { ENABLED_ACCOUNTS_FOR_SYNC } from '@/lib/sync/metaSyncEngine';
import { normalizeAdAccountId } from '@/lib/meta';
import { Logger } from '@/lib/logger';
import { assertDatabaseIsolation } from '@/lib/sync/preflightGuard';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    // 1. Authentication Check
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chưa đăng nhập. Vui lòng đăng nhập lại để thực hiện đối soát dữ liệu.',
          overallStatus: 'ERROR',
          correlationId,
        },
        { status: 401 }
      );
    }

    const actorEmail = auth.user?.email || 'admin';

    // 2. Parse Request Body
    const body = await request.json().catch(() => ({}));
    const {
      adAccountId,
      dateFrom = '2026-10-01',
      dateTo = '2026-10-31',
      connectionId,
    } = body;

    const targetAccountId = adAccountId ? normalizeAdAccountId(adAccountId) : 'act_1380498158917028';

    // 3. Strict Scope Enforcement
    if (!ENABLED_ACCOUNTS_FOR_SYNC.includes(targetAccountId)) {
      await Logger.warn(
        'SYSTEM',
        'AccountScopeRejected',
        `Tài khoản ${targetAccountId} nằm ngoài danh sách cấp phép đối soát.`,
        { correlationId, adAccountId: targetAccountId },
        { actor: actorEmail }
      );
      return NextResponse.json(
        {
          success: false,
          error: `Tài khoản ${targetAccountId} chưa được cấp phép. Trong giai đoạn này chỉ tài khoản GIS Hà Nội (act_1380498158917028) được kích hoạt.`,
          overallStatus: 'ERROR',
          correlationId,
        },
        { status: 400 }
      );
    }

    // 4. Database Isolation Verification
    if (process.env.NODE_ENV !== 'test') {
      try {
        assertDatabaseIsolation();
      } catch (isolationErr: unknown) {
        const msg = isolationErr instanceof Error ? isolationErr.message : String(isolationErr);
        return NextResponse.json(
          {
            success: false,
            error: msg,
            overallStatus: 'ERROR',
            correlationId,
          },
          { status: 403 }
        );
      }
    }

    // 5. Resolve Connection
    let connection = null;
    if (connectionId) {
      connection = await prisma.metaConnection.findUnique({
        where: { id: connectionId },
      });
    }

    if (!connection) {
      // Find connection associated with the account
      connection = await prisma.metaConnection.findFirst({
        where: {
          adAccounts: {
            some: { accountId: targetAccountId },
          },
        },
      });
    }

    if (!connection) {
      connection = await prisma.metaConnection.findFirst({
        where: { status: 'connected' },
      });
    }

    if (!connection) {
      return NextResponse.json(
        {
          success: false,
          error: `Không tìm thấy kết nối Meta hợp lệ cho tài khoản ${targetAccountId}. Vui lòng kiểm tra lại cấu hình kết nối.`,
          overallStatus: 'ERROR',
          correlationId,
        },
        { status: 404 }
      );
    }

    // 6. Execute Independent Reconciliation
    const result = await ReconciliationEngine.reconcile(connection, {
      adAccountId: targetAccountId,
      dateFrom,
      dateTo,
      correlationId,
      actor: actorEmail,
    });

    return NextResponse.json({
      ...result,
      connectionName: connection.connectionName,
    });
  } catch (error: unknown) {
    console.error('Reconciliation route error:', error);
    const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
    return NextResponse.json(
      {
        success: false,
        overallStatus: 'ERROR',
        error: message,
        correlationId,
      },
      { status: 500 }
    );
  }
}
