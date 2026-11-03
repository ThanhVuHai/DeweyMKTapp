import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

// GET: Retrieve all KPI targets
export async function GET() {
  try {
    const kpis = await prisma.kpiTarget.findMany({
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
        { campus: 'asc' },
        { grade: 'asc' },
      ],
    });
    return NextResponse.json({ kpis });
  } catch (error: unknown) {
    console.error('List KPIs error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Add or upsert a KPI Target
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      month,
      year,
      campus,
      grade,
      source,
      targetLeads = 0,
      targetQualifiedLeads = 0,
      targetWl = 0,
      targetEnrollments = 0,
      monthlyBudget = 0,
    } = body;

    if (!month || !year || !campus || !grade || !source) {
      return NextResponse.json(
        { error: 'Month, Year, Campus, Grade, and Source are required' },
        { status: 400 }
      );
    }

    const kpi = await prisma.kpiTarget.upsert({
      where: {
        month_year_campus_grade_source: {
          month,
          year,
          campus,
          grade,
          source,
        },
      },
      update: {
        targetLeads,
        targetQualifiedLeads,
        targetWl,
        targetEnrollments,
        monthlyBudget,
      },
      create: {
        month,
        year,
        campus,
        grade,
        source,
        targetLeads,
        targetQualifiedLeads,
        targetWl,
        targetEnrollments,
        monthlyBudget,
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
        action: 'UPSERT_KPI',
        entityType: 'KPI_TARGET',
        entityId: kpi.id,
        afterJson: JSON.stringify(body),
      },
    });

    return NextResponse.json({ success: true, kpi });
  } catch (error: unknown) {
    console.error('Upsert KPI error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
