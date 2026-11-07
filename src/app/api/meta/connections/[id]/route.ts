import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { verifyAuth } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

// PATCH: Update connection details
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

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

    const updateData: Prisma.MetaConnectionUpdateInput = {};
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
    const userId = auth.user?.id && auth.user.id !== 'admin' ? auth.user.id : null;

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: id,
        afterJson: JSON.stringify({ connectionName, graphApiVersion, syncFrequency }),
      },
    });

    return NextResponse.json({ success: true, connection: updated });
  } catch (error: unknown) {
    console.error('Update connection failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove connection
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }

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
    const userId = auth.user?.id && auth.user.id !== 'admin' ? auth.user.id : null;

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE_CONNECTION',
        entityType: 'META_CONNECTION',
        entityId: id,
        beforeJson: JSON.stringify({ name: existingConnection.connectionName }),
      },
    });

    return NextResponse.json({ success: true, message: 'Connection removed successfully' });
  } catch (error: unknown) {
    console.error('Delete connection failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
