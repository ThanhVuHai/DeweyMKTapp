import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaSyncEngine, ENABLED_ACCOUNTS_FOR_SYNC, normalizeSyncDate } from '@/lib/sync/metaSyncEngine';
import { normalizeAdAccountId, MetaApiError } from '@/lib/meta';
import { Logger } from '@/lib/logger';
import { recordUserAction } from '@/lib/audit';

// Vercel Serverless Function Configuration (Fluid Compute supports up to 300 seconds)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// POST: Execute Manual Meta Ads Synchronization
export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    // 1. Authentication Check
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      await Logger.warn('SYSTEM', 'UnauthorizedSyncAttempt', 'Yêu cầu đồng bộ bị từ chối do chưa xác thực.', { correlationId });
      return NextResponse.json(
        {
          success: false,
          errorCode: 'AUTH_REQUIRED',
          stage: 'authentication',
          httpStatus: 401,
          error: 'Chưa đăng nhập. Vui lòng đăng nhập lại để thực hiện đồng bộ dữ liệu.',
          correlationId,
        },
        { status: 401 }
      );
    }

    const actorEmail = auth.user?.email || 'admin';
    const actorId = auth.user?.id || null;

    // 2. Parse Request Body
    const body = await request.json().catch(() => ({}));
    const {
      adAccountId,
      dateFrom: rawDateFrom,
      dateTo: rawDateTo,
      connectionId,
      force = false,
      mode = 'resume',
      parentJobId,
    } = body;

    const targetAccountId = adAccountId ? normalizeAdAccountId(adAccountId) : 'act_1380498158917028';

    // 3. Verify Account Whitelist Scope
    if (!ENABLED_ACCOUNTS_FOR_SYNC.includes(targetAccountId)) {
      await Logger.warn('SYSTEM', 'AccountScopeRejected', `Tài khoản ${targetAccountId} nằm ngoài danh sách cấp phép.`, {
        correlationId,
        adAccountId: targetAccountId,
      }, { actor: actorEmail });

      return NextResponse.json(
        {
          success: false,
          errorCode: 'ACCOUNT_NOT_ENABLED',
          stage: 'validation',
          httpStatus: 400,
          error: `Tài khoản ${targetAccountId} chưa được cấp phép đồng bộ. Trong giai đoạn này chỉ tài khoản GIS Hà Nội (act_1380498158917028) được kích hoạt.`,
          correlationId,
        },
        { status: 400 }
      );
    }

    // 4. Validate & Normalize Date Range
    const defaultDateTo = new Date().toISOString().split('T')[0];
    const defaultDateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const dateFrom = normalizeSyncDate(rawDateFrom, defaultDateFrom);
    const dateTo = normalizeSyncDate(rawDateTo, defaultDateTo);

    if (dateFrom > dateTo) {
      await Logger.warn('SYSTEM', 'InvalidDateRange', `Khoảng thời gian không hợp lệ: ${dateFrom} > ${dateTo}`, {
        correlationId,
        adAccountId: targetAccountId,
      }, { actor: actorEmail });

      return NextResponse.json(
        {
          success: false,
          errorCode: 'INVALID_DATE_RANGE',
          stage: 'validation',
          httpStatus: 400,
          error: `Khoảng thời gian không hợp lệ: Ngày bắt đầu (${dateFrom}) lớn hơn ngày kết thúc (${dateTo}).`,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Event 1: Manual synchronization requested
    await Logger.info(
      'SYSTEM',
      'ManualSyncRequested',
      `Người dùng yêu cầu đồng bộ thủ công cho tài khoản ${targetAccountId} (${dateFrom} -> ${dateTo})`,
      {
        correlationId,
        adAccountId: targetAccountId,
        reportingDateFrom: new Date(dateFrom),
        reportingDateTo: new Date(dateTo),
      },
      {
        actor: actorEmail,
        stage: 'request_intake',
        metadata: { force, connectionId },
      }
    );

    // Record user action in AuditLog
    await recordUserAction({
      userId: actorId,
      actorEmail,
      action: 'MANUAL_SYNC_REQUESTED',
      entityType: 'AdAccount',
      entityId: targetAccountId,
      after: { dateFrom, dateTo, force },
    });

    // 5. Resolve MetaConnection
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
      await Logger.error(
        'META_CONNECTION',
        'ConnectionNotFound',
        'Không tìm thấy kết nối Meta API hợp lệ trong hệ thống.',
        { correlationId, adAccountId: targetAccountId },
        { actor: actorEmail, stage: 'connection_resolution' }
      );

      return NextResponse.json(
        {
          success: false,
          errorCode: 'CONNECTION_NOT_FOUND',
          stage: 'connection_resolution',
          httpStatus: 404,
          error: 'Không tìm thấy kết nối Meta API nào. Vui lòng cấu hình kết nối trước.',
          correlationId,
        },
        { status: 404 }
      );
    }

    // 6. Execute Synchronization via MetaSyncEngine with Date Chunking & Persistent Checkpoints
    const syncResult = await MetaSyncEngine.syncAdAccount(connection, {
      adAccountId: targetAccountId,
      dateFrom,
      dateTo,
      jobType: 'manual_sync',
      force,
      mode,
      parentJobId,
      correlationId,
      actor: actorEmail,
    });

    const isFullSuccess = syncResult.status === 'SUCCESS';
    const isPartial = syncResult.status === 'PARTIAL';

    let message = '';
    if (isFullSuccess) {
      message = `Đồng bộ dữ liệu Meta thành công cho tài khoản ${syncResult.accountName}! (${syncResult.datesSummary.successfulCount}/${syncResult.datesSummary.totalDates} ngày)`;
    } else if (isPartial) {
      message = `Đồng bộ một phần cho tài khoản ${syncResult.accountName}: ${syncResult.datesSummary.successfulCount} ngày thành công, ${syncResult.datesSummary.failedCount} ngày lỗi, ${syncResult.datesSummary.unprocessedCount} ngày chưa xử lý.`;
    } else {
      message = `Đồng bộ thất bại: 0/${syncResult.datesSummary.totalDates} ngày thành công.${syncResult.error ? ` Lỗi: ${syncResult.error}` : ''}`;
    }

    return NextResponse.json(
      {
        success: isFullSuccess || isPartial,
        status: syncResult.status,
        correlationId,
        message,
        data: syncResult,
      },
      { status: syncResult.status === 'FAILED' ? 400 : 200 }
    );
  } catch (error: unknown) {
    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          success: false,
          errorCode: error.code || 'META_API_ERROR',
          stage: 'meta_api_call',
          httpStatus: 400,
          error: error.userMessage || error.message,
          category: error.category,
          technicalDetails: error.technicalDetails,
          correlationId,
        },
        { status: 400 }
      );
    }

    const errorMsg = error instanceof Error ? error.message : 'Unknown synchronization error';
    return NextResponse.json(
      {
        success: false,
        errorCode: 'SYNC_EXECUTION_ERROR',
        stage: 'persistence_execution',
        httpStatus: 500,
        error: errorMsg,
        correlationId,
      },
      { status: 500 }
    );
  }
}
