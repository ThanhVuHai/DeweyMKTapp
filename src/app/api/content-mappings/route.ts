import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

// Helper to parse ad names: e.g. CG_G6_MOFU_IBOBJECTION_VIDEO_NA_C012
export function parseNamingConvention(name: string) {
  const parts = name.split('_');
  if (parts.length >= 7) {
    return {
      campus: parts[0],             // CG
      grade: parts[1],              // G6
      funnelStage: parts[2],        // MOFU
      angle: parts[3],              // IBOBJECTION
      format: parts[4],             // VIDEO
      offer: parts[5],              // NA
      contentId: parts[6],          // C012
    };
  }
  return null;
}

// GET: List all mappings
export async function GET() {
  try {
    const mappings = await prisma.contentMapping.findMany({
      include: {
        ad: {
          include: {
            campaign: true
          }
        }
      }
    });
    return NextResponse.json({ mappings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      }
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
        action: 'UPSERT_CONTENT_MAPPING',
        entityType: 'CONTENT_MAPPING',
        entityId: mapping.id,
        afterJson: JSON.stringify(body),
      }
    });

    return NextResponse.json({ success: true, mapping });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
