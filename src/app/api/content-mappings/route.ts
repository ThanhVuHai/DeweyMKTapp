import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

// GET: List all mappings
export async function GET() {
  try {
    const mappings = await prisma.contentMapping.findMany({
      include: {
        ad: {
          include: {
            campaign: true,
          },
        },
      },
    });
    return NextResponse.json({ mappings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Add or edit a mapping for a specific ad
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      adId,
      contentId,
      campus,
      grade,
      funnelStage,
      campaignTheme,
      angle,
      insight,
      hookType,
      format,
      offer,
      creator,
      contentStatus = 'testing',
      note,
    } = body;

    if (!adId) {
      return NextResponse.json({ error: 'adId is required' }, { status: 400 });
    }

    const mapping = await prisma.contentMapping.upsert({
      where: { adId },
      update: {
        contentId,
        campus,
        grade,
        funnelStage,
        campaignTheme,
        angle,
        insight,
        hookType,
        format,
        offer,
        creator,
        contentStatus,
        note,
      },
      create: {
        adId,
        contentId,
        campus,
        grade,
        funnelStage,
        campaignTheme,
        angle,
        insight,
        hookType,
        format,
        offer,
        creator,
        contentStatus,
        note,
      },
    });

    // Write audit log
    let userId: string | null = null;
    try {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('session');
      if (sessionCookie && sessionCookie.value) {
        const parsedCookie = JSON.parse(sessionCookie.value) as { id?: string };
        userId = parsedCookie.id || null;
      }
    } catch {
      // Session cookie optional
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'UPSERT_CONTENT_MAPPING',
        entityType: 'CONTENT_MAPPING',
        entityId: mapping.id,
        afterJson: JSON.stringify(body),
      },
    });

    return NextResponse.json({ success: true, mapping });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
