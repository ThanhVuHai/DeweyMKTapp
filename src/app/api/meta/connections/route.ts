import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt, maskToken } from '@/lib/crypto';
import { normalizeAdAccountId, MetaApiService } from '@/lib/meta';
import { verifyAuth } from '@/lib/auth';

// GET: List all connections
export async function GET(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const connections = await prisma.metaConnection.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        adAccounts: true,
      },
    });

    // Mask access token for frontend display
    const sanitizedConnections = connections.map(conn => ({
      ...conn,
      encryptedAccessToken: maskToken(conn.encryptedAccessToken),
      encryptedAppSecret: conn.encryptedAppSecret ? '********' : null,
    }));

    return NextResponse.json({ connections: sanitizedConnections });
  } catch (error: unknown) {
    console.error('List connections failed:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST: Add a new Meta Connection
export async function POST(request: Request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      connectionName,
      graphApiVersion = 'v25.0',
      accessToken,
      adAccountId,
      appId,
      appSecret,
      syncStartDate,
      syncFrequency = 'Manual',
    } = body;

    if (!connectionName || !accessToken || !syncStartDate) {
      return NextResponse.json(
        { error: 'Tên kết nối, Access Token và Ngày bắt đầu đồng bộ là bắt buộc' },
        { status: 400 }
      );
    }

    const userId = auth.user?.id || 'admin';

    // Encrypt security credentials
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedAppSecret = appSecret ? encrypt(appSecret) : null;

    const connection = await prisma.metaConnection.create({
      data: {
        userId,
        connectionName,
        graphApiVersion,
        encryptedAccessToken,
        encryptedAppSecret,
        appId: appId || null,
        syncStartDate: new Date(syncStartDate),
        syncFrequency,
        status: 'disconnected', // Initially disconnected until verified
      },
    });

    // If an initial Ad Account ID was provided, automatically link it
    if (adAccountId) {
      const normalizedId = normalizeAdAccountId(adAccountId);
      try {
        const accountInfo = await MetaApiService.getAdAccount(normalizedId, {
          encryptedAccessToken,
          graphApiVersion,
        });

        await prisma.adAccount.create({
          data: {
            metaConnectionId: connection.id,
            accountId: normalizedId,
            accountName: accountInfo.accountName || `Ad Account ${normalizedId}`,
            currency: accountInfo.currency || 'VND',
            timezoneName: accountInfo.timezoneName || 'Asia/Ho_Chi_Minh',
            status: accountInfo.status || 'ACTIVE',
          },
        });
      } catch (err) {
        console.warn('Initial Ad Account link warning:', (err as Error).message);
      }
    }

    // Write audit log
    try {
      await prisma.auditLog.create({
        data: {
          userId: userId && userId !== 'admin' ? userId : null,
          action: 'CREATE_CONNECTION',
          entityType: 'MetaConnection',
          entityId: connection.id,
          afterJson: JSON.stringify({ connectionName }),
        },
      });
    } catch {
      // Audit log optional
    }

    return NextResponse.json({
      success: true,
      connection: {
        ...connection,
        encryptedAccessToken: maskToken(connection.encryptedAccessToken),
        encryptedAppSecret: connection.encryptedAppSecret ? '********' : null,
      },
    });
  } catch (error: unknown) {
    console.error('Create connection failed:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
