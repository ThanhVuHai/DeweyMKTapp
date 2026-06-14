import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { cookies } from 'next/headers';

// PATCH: Update connection details
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      connectionName,
      graphApiVersion,
      accessToken,
      appId,
      appSecret,
      syncStartDate,
      syncFrequency,
    } = body;

    const existingConnection = await prisma.metaConnection.findUnique({
      where: { id },
    });

    if (!existingConnection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const updateData: any = {};
    if (connectionName) updateData.connectionName = connectionName;
    if (graphApiVersion) updateData.graphApiVersion = graphApiVersion;
    if (appId !== undefined) updateData.appId = appId;
    if (syncStartDate) updateData.syncStartDate = new Date(syncStartDate);
    if (syncFrequency) updateData.syncFrequency = syncFrequency;

    if (accessToken) {
      updateData.encryptedAccessToken = encrypt(accessToken);
      updateData.status = 'disconnected'; // reset status to verify new token
    }

    if (appSecret) {
      updateData.encryptedAppSecret = encrypt(appSecret);
    } else if (appSecret === null) {
      updateData.encryptedAppSecret = null;
    }

    const updated = await prisma.metaConnection.update({
      where: { id },
      data: updateData,
    });

    // Write audit log
    let userId = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        userId = JSON.parse(sessionCookie.value).id;
      }
    } catch (_) {}

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: id,
        afterJson: JSON.stringify({ connectionName, graphApiVersion, syncFrequency }),
      }
    });

    return NextResponse.json({ success: true, connection: updated });
  } catch (error: any) {
    console.error('Update connection failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Remove connection
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const existingConnection = await prisma.metaConnection.findUnique({
      where: { id },
    });

    if (!existingConnection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    await prisma.metaConnection.delete({
      where: { id },
    });

    // Write audit log
    let userId = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        userId = JSON.parse(sessionCookie.value).id;
      }
    } catch (_) {}

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: id,
        beforeJson: JSON.stringify({ name: existingConnection.connectionName }),
      }
    });

    return NextResponse.json({ success: true, message: 'Connection removed successfully' });
  } catch (error: any) {
    console.error('Delete connection failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
