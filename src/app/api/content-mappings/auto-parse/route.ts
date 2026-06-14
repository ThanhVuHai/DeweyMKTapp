import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseNamingConvention } from '../route';
import { cookies } from 'next/headers';

export async function POST() {
  try {
    // 1. Fetch ads that do NOT have a content mapping
    const adsWithoutMapping = await prisma.ad.findMany({
      where: {
        contentMapping: {
          is: null
        }
      }
    });

    let count = 0;
    const parsedMappings = [];

    for (const ad of adsWithoutMapping) {
      const parsed = parseNamingConvention(ad.adName);
      if (parsed) {
        const mapping = await prisma.contentMapping.create({
          data: {
            adId: ad.id,
            contentId: parsed.contentId,
            campus: parsed.campus,
            grade: parsed.grade,
            funnelStage: parsed.funnelStage,
            campaignTheme: 'Tuyển sinh Tự động Nhận diện',
            angle: parsed.angle,
            format: parsed.format,
            offer: parsed.offer,
            contentStatus: 'testing',
            note: 'Tự động phân tích từ định dạng đặt tên adName.',
          }
        });
        parsedMappings.push(mapping);
        count++;
      }
    }

    // Write audit log if parsed any
    if (count > 0) {
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
          action: 'AUTO_PARSE_CONTENT_MAPPINGS',
          entityType: 'CONTENT_MAPPING',
          entityId: 'BATCH',
          afterJson: JSON.stringify({ parsedCount: count, parsedMappings }),
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: `Tự động phân tích và tạo thành công ${count} mẫu content mapping.`,
      count
    });
  } catch (error: any) {
    console.error('Auto parse content mappings failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
