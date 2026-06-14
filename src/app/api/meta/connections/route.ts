import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt, maskToken } from '@/lib/crypto';
import { cookies } from 'next/headers';

// GET: List all connections
export async function GET() {
  try {
    const connections = await prisma.metaConnection.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        adAccounts: true,
      }
    });

    // Mask access token for frontend display
    const sanitizedConnections = connections.map(conn => ({
      ...conn,
      encryptedAccessToken: maskToken(conn.encryptedAccessToken),
      encryptedAppSecret: conn.encryptedAppSecret ? '********' : null,
    }));

    return NextResponse.json({ connections: sanitizedConnections });
  } catch (error: any) {
    console.error('List connections failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      appId,
      appSecret,
      syncStartDate,
      syncFrequency = 'Manual',
    } = body;

    if (!connectionName || !accessToken || !syncStartDate) {
      return NextResponse.json(
        { error: 'Connection Name, Access Token and Sync Start Date are required' },
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
      // If running local/dev and session doesn't exist, assign to first user or create admin fallback
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

    // Write audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: connection.id,
        afterJson: JSON.stringify({ connectionName, graphApiVersion, syncFrequency }),
      }
    });

    return NextResponse.json({ success: true, connectionId: connection.id });
  } catch (error: any) {
    console.error('Create connection failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
