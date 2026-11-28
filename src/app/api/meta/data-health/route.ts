import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAuth } from '@/lib/auth';
import { DataHealthService } from '@/lib/sync/dataHealthService';
import { ENABLED_ACCOUNTS_FOR_SYNC } from '@/lib/sync/metaSyncEngine';
import { normalizeAdAccountId } from '@/lib/meta';
import { Logger } from '@/lib/logger';
import { assertDatabaseIsolation } from '@/lib/sync/preflightGuard';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    // 1. Authentication Check
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chưa đăng nhập. Vui lòng đăng nhập lại để xem giám sát sức khỏe dữ liệu.',
          correlationId,
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rawAccountId = searchParams.get('adAccountId') || 'act_1380498158917028';
    const dateFrom = searchParams.get('dateFrom') || '2026-10-01';
    const dateTo = searchParams.get('dateTo') || '2026-10-31';

    const targetAccountId = normalizeAdAccountId(rawAccountId);

    // 2. Strict Scope Enforcement
    if (!ENABLED_ACCOUNTS_FOR_SYNC.includes(targetAccountId)) {
      await Logger.warn(
        'SYSTEM',
        'AccountScopeRejected',
        `Tài khoản ${targetAccountId} nằm ngoài danh sách cấp phép giám sát sức khỏe dữ liệu.`,
        { correlationId, adAccountId: targetAccountId },
        { actor: auth.user?.email || 'admin' }
      );
      return NextResponse.json(
        {
          success: false,
          error: `Tài khoản ${targetAccountId} chưa được kích hoạt. Trong giai đoạn nghiệm thu Preview chỉ tài khoản GIS Hà Nội (act_1380498158917028) được phép sử dụng.`,
          correlationId,
        },
        { status: 400 }
      );
    }

    // 3. Database Isolation Verification
    if (process.env.NODE_ENV !== 'test') {
      try {
        assertDatabaseIsolation();
      } catch (isolationErr: unknown) {
        const msg = isolationErr instanceof Error ? isolationErr.message : String(isolationErr);
        return NextResponse.json(
          {
            success: false,
            error: msg,
            correlationId,
          },
          { status: 403 }
        );
      }
    }

    // 4. Retrieve Centralized Data Health
    const healthResult = await DataHealthService.getDataHealth({
      adAccountId: targetAccountId,
      dateFrom,
      dateTo,
    });

    return NextResponse.json(healthResult);
  } catch (error: unknown) {
    console.error('DataHealth GET route error:', error);
    const message = error instanceof Error ? error.message : 'Unknown data health error';
    return NextResponse.json(
      {
        success: false,
        error: message,
        correlationId,
      },
      { status: 500 }
    );
  }
}
