import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { seedDatabase } from '@/lib/seedData';
import { cookies } from 'next/headers';

export async function POST() {
  try {
    // Audit log details
    let userId: string | null = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        const userData = JSON.parse(sessionCookie.value) as { id?: string };
        userId = userData.id || null;
      }
    } catch {
      // Session cookie optional
    }

    await seedDatabase(prisma);

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'SEED_DEMO_DATA',
        entityType: 'DATABASE',
        entityId: 'ALL',
        afterJson: JSON.stringify({ message: 'Seeded demo records for all dashboards' }),
      },
    });

    return NextResponse.json({ success: true, message: 'Seeded demo data successfully!' });
  } catch (error: unknown) {
    console.error('Seed API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to seed database: ' + message },
      { status: 500 }
    );
  }
}
