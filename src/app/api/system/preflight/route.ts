import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaApiService, isMockToken } from '@/lib/meta';
import {
  getDatabaseEndpointInfo,
  verifyDatabaseIsolation,
  IsolationStatus,
} from '@/lib/sync/preflightGuard';

export interface PreflightResponse {
  success: boolean;
  timestamp: string;
  environment: {
    vercelEnv: string;
    region: string;
    deploymentUrl: string;
  };
  git: {
    branch: string;
    commit: string;
    commitMessage?: string;
  };
  database: {
    connected: boolean;
    isLocal: boolean;
    isNeon: boolean;
    isPooled: boolean;
    maskedHost: string;
    databaseName?: string;
    error?: string;
  };
  databaseIsolation: {
    status: IsolationStatus;
    isIsolated: boolean;
    actualEndpointId: string;
    expectedEndpointId: string | null;
    message: string;
    reason?: string;
  };
  meta: {
    connectionExists: boolean;
    connectionName?: string;
    status?: string;
    dataMode: 'LIVE' | 'MOCK' | 'UNKNOWN';
    tokenValid: boolean;
    hasAdsRead: boolean;
    hasBusinessManagement: boolean;
    userName?: string;
    targetAccountLinked: boolean;
    targetAccountAccessible: boolean;
    targetAccountId: string;
    targetAccountName?: string;
    error?: string;
  };
  task2Readiness: {
    status: 'READY' | 'BLOCKED';
    blockers: string[];
    canExecuteSync: boolean;
  };
}

export async function GET(request: Request) {
  try {
    // 1. Existing server-side authentication protection
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại để xem thông tin chẩn đoán hệ thống.' },
        { status: 401 }
      );
    }

    const blockers: string[] = [];

    // 2. Vercel runtime environment & Git metadata
    const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
    const region = process.env.VERCEL_REGION || 'local';
    const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const gitBranch = process.env.VERCEL_GIT_COMMIT_REF || 'stage-1a-meta-read-only';
    const gitCommit = (process.env.VERCEL_GIT_COMMIT_SHA || '8b87075').slice(0, 7);
    const gitCommitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';

    // 3. Database connectivity using a read-only query
    let dbConnected = false;
    let dbError: string | undefined = undefined;
    try {
      // Light non-mutating check
      await prisma.$queryRaw`SELECT 1 as connected`;
      dbConnected = true;
    } catch (err: unknown) {
      dbConnected = false;
      dbError = (err as Error).message;
      blockers.push(`Kết nối Database thất bại: ${dbError}`);
    }

    // 4. Effective database endpoint & isolation verification
    const endpointInfo = getDatabaseEndpointInfo();
    const isolationResult = verifyDatabaseIsolation();

    if (isolationResult.status !== 'PASS') {
      blockers.push(`Cách ly Database chưa đạt PASS (${isolationResult.status}): ${isolationResult.message}`);
    }

    // 5. Existing MetaConnection and AdAccount availability
    let connectionExists = false;
    let connectionName: string | undefined = undefined;
    let connectionStatus: string | undefined = undefined;
    let dataMode: 'LIVE' | 'MOCK' | 'UNKNOWN' = 'UNKNOWN';
    let tokenValid = false;
    let hasAdsRead = false;
    let hasBusinessManagement = false;
    let userName: string | undefined = undefined;
    let targetAccountLinked = false;
    let targetAccountAccessible = false;
    let targetAccountName: string | undefined = undefined;
    let metaError: string | undefined = undefined;

    const targetAccountId = 'act_1380498158917028';

    try {
      const activeConnection = await prisma.metaConnection.findFirst({
        include: { adAccounts: true },
        orderBy: { createdAt: 'desc' },
      });

      if (activeConnection) {
        connectionExists = true;
        connectionName = activeConnection.connectionName;
        connectionStatus = activeConnection.status;

        const decryptedToken = MetaApiService.getDecryptedToken(activeConnection);
        const isMock = isMockToken(decryptedToken);
        dataMode = isMock ? 'MOCK' : 'LIVE';

        // Check if GIS Hà Nội is linked
        const linkedAccount = activeConnection.adAccounts.find(
          a => a.accountId === targetAccountId || a.accountId === targetAccountId.replace('act_', '')
        );
        if (linkedAccount) {
          targetAccountLinked = true;
          targetAccountName = linkedAccount.accountName;
        }

        // Validate token permissions live against Meta Graph API
        try {
          const tokenInfo = await MetaApiService.getTokenPermissions(activeConnection);
          tokenValid = !!tokenInfo.valid;
          hasAdsRead = !!tokenInfo.hasAdsRead;
          hasBusinessManagement = !!tokenInfo.hasBusinessManagement;
          userName = tokenInfo.userName;

          if (!hasAdsRead) {
            blockers.push("Token Meta thiếu quyền bắt buộc 'ads_read'.");
          }
        } catch (tokErr: unknown) {
          tokenValid = false;
          metaError = (tokErr as Error).message;
          blockers.push(`Kiểm tra Token Meta thất bại: ${metaError}`);
        }

        // Validate target account accessibility
        if (tokenValid && hasAdsRead) {
          try {
            const accInfo = await MetaApiService.getAdAccount(targetAccountId, activeConnection);
            if (accInfo) {
              targetAccountAccessible = true;
              targetAccountName = accInfo.accountName || targetAccountName;
            }
          } catch (accErr: unknown) {
            targetAccountAccessible = false;
            blockers.push(`Không thể truy cập tài khoản GIS Hà Nội (${targetAccountId}): ${(accErr as Error).message}`);
          }
        }

        if (dataMode === 'MOCK') {
          blockers.push('Kết nối đang ở chế độ MOCK (Token Demo). Cần cập nhật Token Meta thật để tiến hành đồng bộ dữ liệu.');
        }
      } else {
        blockers.push('Chưa tìm thấy bản ghi MetaConnection nào trong cơ sở dữ liệu.');
      }
    } catch (queryErr: unknown) {
      metaError = (queryErr as Error).message;
      blockers.push(`Lỗi truy vấn thông tin MetaConnection từ DB: ${metaError}`);
    }

    const canExecuteSync = blockers.length === 0 && isolationResult.status === 'PASS' && dataMode === 'LIVE';

    const responsePayload: PreflightResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      environment: {
        vercelEnv,
        region,
        deploymentUrl,
      },
      git: {
        branch: gitBranch,
        commit: gitCommit,
        commitMessage: gitCommitMessage || undefined,
      },
      database: {
        connected: dbConnected,
        isLocal: endpointInfo.isLocal,
        isNeon: endpointInfo.isNeon,
        isPooled: endpointInfo.isPooled,
        maskedHost: endpointInfo.maskedHost,
        databaseName: endpointInfo.databaseName,
        error: dbError,
      },
      databaseIsolation: {
        status: isolationResult.status,
        isIsolated: isolationResult.isIsolated,
        actualEndpointId: isolationResult.actualEndpointId,
        expectedEndpointId: isolationResult.expectedEndpointId,
        message: isolationResult.message,
        reason: isolationResult.reason,
      },
      meta: {
        connectionExists,
        connectionName,
        status: connectionStatus,
        dataMode,
        tokenValid,
        hasAdsRead,
        hasBusinessManagement,
        userName,
        targetAccountLinked,
        targetAccountAccessible,
        targetAccountId,
        targetAccountName,
        error: metaError,
      },
      task2Readiness: {
        status: canExecuteSync ? 'READY' : 'BLOCKED',
        blockers,
        canExecuteSync,
      },
    };

    return NextResponse.json(responsePayload);
  } catch (err: unknown) {
    console.error('System Preflight API Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message || 'Unknown internal preflight error',
      },
      { status: 500 }
    );
  }
}
