import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { status, assignedTo } = await request.json();

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    const existingRec = await prisma.recommendation.findUnique({
      where: { id },
    });

    if (!existingRec) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    const updated = await prisma.recommendation.update({
      where: { id },
      data: {
        status,
        assignedTo: assignedTo !== undefined ? assignedTo : undefined,
      },
    });

    // Write audit log
    let userId: string | null = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        const parsed = JSON.parse(sessionCookie.value) as { id?: string };
        userId = parsed.id || null;
      }
    } catch {
      // Session cookie optional
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_RECOMMENDATION_STATUS',
        entityType: 'RECOMMENDATION',
        entityId: id,
        beforeJson: JSON.stringify({ status: existingRec.status }),
        afterJson: JSON.stringify({ status, assignedTo }),
      },
    });

    return NextResponse.json({ success: true, recommendation: updated });
  } catch (error: unknown) {
    console.error('Update recommendation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
