import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true
          }
        }
      },
      take: 100 // Limit to last 100 entries for security & speed
    });
    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error('List audit logs failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
