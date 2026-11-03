import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existingKpi = await prisma.kpiTarget.findUnique({
      where: { id },
    });

    if (!existingKpi) {
      return NextResponse.json({ error: 'KPI target not found' }, { status: 404 });
    }

    await prisma.kpiTarget.delete({
      where: { id },
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
        action: 'DELETE_KPI',
        entityType: 'KPI_TARGET',
        entityId: id,
        beforeJson: JSON.stringify(existingKpi),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Delete KPI error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
