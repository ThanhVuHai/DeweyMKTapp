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
      // Run verification & inspect permissions
      const tokenInfo = await MetaApiService.getTokenPermissions({
        encryptedAccessToken: connection.encryptedAccessToken,
        graphApiVersion: connection.graphApiVersion,
      });

      if (tokenInfo.valid) {
        // Update connection status
        await prisma.metaConnection.update({
          where: { id: connection.id },
          data: {
            status: 'connected',
            lastTestedAt: new Date(),
          },
        });

        const isMock =
          connection.encryptedAccessToken.includes('Fake') ||
          connection.encryptedAccessToken.includes('mock-token');

        return NextResponse.json({
          success: true,
          message: 'Kết nối và xác thực Token thành công!',
          details: {
            userName: tokenInfo.userName || (isMock ? 'Dewey School Demo Manager' : 'Meta Ads User'),
            userId: tokenInfo.userId || 'N/A',
            permissions: tokenInfo.permissions,
            hasAdsRead: tokenInfo.hasAdsRead,
            hasBusinessManagement: tokenInfo.hasBusinessManagement,
            linkedAccountsCount: connection.adAccounts.length,
            status: 'connected',
          },
        });
      }

      throw new Error('Xác thực token thất bại');
    } catch (apiError: unknown) {
      const err = apiError as MetaApiError;
      console.error('Test connection error:', err);

      // Update DB status to error
      await prisma.metaConnection.update({
        where: { id: connection.id },
        data: {
          status: 'error',
          lastTestedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: false,
        error: err.userMessage || err.message || 'Lỗi khi xác thực token Meta API',
        category: err.category || 'API_ERROR',
        technicalDetails: err.technicalDetails || err.message,
      });
    }
  } catch (error: unknown) {
    console.error('Test connection API error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
