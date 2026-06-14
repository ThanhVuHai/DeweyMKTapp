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
        action: 'DELETE_KPI',
        entityType: 'KPI_TARGET',
        entityId: id,
        beforeJson: JSON.stringify(existingKpi),
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete KPI error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
