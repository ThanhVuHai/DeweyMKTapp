import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuth } from '@/lib/auth';
import { MetaApiService, MetaApiError, normalizeAdAccountId } from '@/lib/meta';

// POST: Manually link an Ad Account by ID
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
    const body = await request.json();
    const rawAccountId = body.accountId;

    if (!rawAccountId || typeof rawAccountId !== 'string' || !rawAccountId.trim()) {
      return NextResponse.json(
        { error: 'Vui lòng nhập Ad Account ID (ví dụ: act_123456789 hoặc 123456789)' },
        { status: 400 }
      );
    }

    const connection = await prisma.metaConnection.findUnique({
      where: { id },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Không tìm thấy kết nối' }, { status: 404 });
    }

    const normalizedId = normalizeAdAccountId(rawAccountId);

    try {
      // 1. Verify access to this specific Ad Account ID using ads_read
      const accountInfo = await MetaApiService.getAdAccount(normalizedId, {
        encryptedAccessToken: connection.encryptedAccessToken,
        graphApiVersion: connection.graphApiVersion,
      });

      // 2. Optional Business Manager enrichment (isolated, won't fail if business_management missing)
      let businessId = accountInfo.businessId;
      try {
        const bm = await MetaApiService.getBusinessInfo(normalizedId, {
          encryptedAccessToken: connection.encryptedAccessToken,
          graphApiVersion: connection.graphApiVersion,
        });
        if (bm?.businessId) {
          businessId = bm.businessId;
        }
      } catch {
        // Ignore BM fetch failure
      }

      // 3. Upsert AdAccount into Database
      const adAccount = await prisma.adAccount.upsert({
        where: { accountId: accountInfo.accountId },
        update: {
          accountName: accountInfo.accountName,
          currency: accountInfo.currency,
          timezoneName: accountInfo.timezoneName,
          businessId: businessId || null,
          status: accountInfo.status || 'ACTIVE',
        },
        create: {
          metaConnectionId: connection.id,
          accountId: accountInfo.accountId,
          accountName: accountInfo.accountName,
          currency: accountInfo.currency,
          timezoneName: accountInfo.timezoneName,
          businessId: businessId || null,
          status: accountInfo.status || 'ACTIVE',
        },
      });

      return NextResponse.json({
        success: true,
        message: `Đã xác thực và liên kết tài khoản quảng cáo "${adAccount.accountName}" (${adAccount.accountId}) thành công!`,
        account: adAccount,
      });
    } catch (apiError: unknown) {
      const err = apiError as MetaApiError;
      console.error('Verify ad account error:', err);

      return NextResponse.json(
        {
          success: false,
          error:
            err.userMessage ||
            err.message ||
            `Không thể xác thực quyền truy cập tài khoản ${normalizedId}`,
          category: err.category || 'API_ERROR',
          technicalDetails: err.technicalDetails || err.message,
        },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    console.error('Manual account API error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE: Unlink an Ad Account
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json(
        { error: 'Thiếu tham số accountId cần gỡ bỏ' },
        { status: 400 }
      );
    }

    const existingAccount = await prisma.adAccount.findFirst({
      where: {
        accountId,
        metaConnectionId: id,
      },
    });

    if (!existingAccount) {
      return NextResponse.json(
        { error: 'Không tìm thấy tài khoản quảng cáo này trong kết nối' },
        { status: 404 }
      );
    }

    await prisma.adAccount.delete({
      where: { id: existingAccount.id },
    });

    return NextResponse.json({
      success: true,
      message: `Đã gỡ bỏ tài khoản ${accountId} khỏi kết nối.`,
    });
  } catch (error: unknown) {
    console.error('Delete account API error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

