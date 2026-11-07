import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaApiService, MetaApiError } from '@/lib/meta';

export async function POST(
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

    const connection = await prisma.metaConnection.findUnique({
      where: { id },
      include: {
        adAccounts: true,
      },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Không tìm thấy kết nối' }, { status: 404 });
    }

    try {
      // 1. Fetch Ad Accounts using basic 'ads_read' permissions (without business field)
      const accounts = await MetaApiService.getAdAccounts({
        encryptedAccessToken: connection.encryptedAccessToken,
        graphApiVersion: connection.graphApiVersion,
      });

      if (!accounts || accounts.length === 0) {
        return NextResponse.json({
          success: true,
          count: 0,
          accounts: connection.adAccounts,
          message: 'Không tìm thấy Ad Account nào trong me/adaccounts. Bạn có thể dùng tính năng "Nhập Ad Account ID thủ công" để liên kết trực tiếp.',
        });
      }

      const upsertedAccounts = [];

      for (const acc of accounts) {
        // 2. Optional non-blocking Business Manager check (won't fail if business_management is absent)
        let businessId = acc.businessId;
        try {
          const bm = await MetaApiService.getBusinessInfo(acc.accountId, {
            encryptedAccessToken: connection.encryptedAccessToken,
            graphApiVersion: connection.graphApiVersion,
          });
          if (bm?.businessId) {
            businessId = bm.businessId;
          }
        } catch {
          // Ignore, basic account discovery never depends on business_management
        }

        const adAccount = await prisma.adAccount.upsert({
          where: { accountId: acc.accountId },
          update: {
            accountName: acc.accountName,
            currency: acc.currency,
            timezoneName: acc.timezoneName,
            businessId: businessId || null,
            status: acc.status || 'ACTIVE',
          },
          create: {
            metaConnectionId: connection.id,
            accountId: acc.accountId,
            accountName: acc.accountName,
            currency: acc.currency,
            timezoneName: acc.timezoneName,
            businessId: businessId || null,
            status: acc.status || 'ACTIVE',
          },
        });
        upsertedAccounts.push(adAccount);
      }

      // Update connection status and timestamp
      await prisma.metaConnection.update({
        where: { id: connection.id },
        data: {
          status: 'connected',
          lastTestedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        count: upsertedAccounts.length,
        accounts: upsertedAccounts,
        message: `Đã tìm thấy và đồng bộ thành công ${upsertedAccounts.length} Ad Accounts!`,
      });
    } catch (apiError: unknown) {
      const err = apiError as MetaApiError;
      console.error('Fetch ad accounts error:', err);

      return NextResponse.json({
        success: false,
        error: err.userMessage || err.message || 'Lỗi khi đồng bộ danh sách Ad Accounts từ Meta API',
        category: err.category || 'API_ERROR',
        technicalDetails: err.technicalDetails || err.message,
      });
    }
  } catch (error: unknown) {
    console.error('Fetch accounts API error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
