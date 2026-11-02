import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt, maskToken } from '@/lib/crypto';
import { normalizeAdAccountId, MetaApiService } from '@/lib/meta';
import { cookies } from 'next/headers';

// GET: List all connections
export async function GET() {
  try {
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

    // Get current user ID
    let userId = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        userId = JSON.parse(sessionCookie.value).id;
      }
    } catch (_) {}

    if (!userId) {
      const fallbackUser = await prisma.user.findFirst();
      userId = fallbackUser ? fallbackUser.id : 'default-user-id';
    }

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
        appId,
        syncStartDate: new Date(syncStartDate),
        syncFrequency,
        status: 'disconnected', // Initially disconnected until verified
      },
    });

    // If user specified an Ad Account ID during creation, verify and link it
    if (adAccountId && typeof adAccountId === 'string' && adAccountId.trim()) {
      const normalized = normalizeAdAccountId(adAccountId);
      try {
        const accountInfo = await MetaApiService.getAdAccount(normalized, {
          encryptedAccessToken,
          graphApiVersion,
        });

        await prisma.adAccount.create({
          data: {
            metaConnectionId: connection.id,
            accountId: accountInfo.accountId,
            accountName: accountInfo.accountName,
            currency: accountInfo.currency,
            timezoneName: accountInfo.timezoneName,
            status: accountInfo.status || 'ACTIVE',
          },
        });
      } catch (accErr) {
        console.warn('Initial ad account link skipped on create:', (accErr as Error).message);
        // We still created connection successfully; user can verify or add account later
      }
    }

    // Write audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: connection.id,
        afterJson: JSON.stringify({ connectionName, graphApiVersion, syncFrequency, adAccountId }),
      },
    });

    return NextResponse.json({ success: true, connectionId: connection.id });
  } catch (error: unknown) {
    console.error('Create connection failed:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
