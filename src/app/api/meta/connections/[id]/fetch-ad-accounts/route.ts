import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { MetaApiService } from '@/lib/meta';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const connection = await prisma.metaConnection.findUnique({
      where: { id },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    try {
      const accounts = await MetaApiService.getAdAccounts({
        encryptedAccessToken: connection.encryptedAccessToken,
        graphApiVersion: connection.graphApiVersion,
      });

      const upsertedAccounts = [];

      for (const acc of accounts) {
        const adAccount = await prisma.adAccount.upsert({
          where: { accountId: acc.accountId },
          update: {
            accountName: acc.accountName,
            currency: acc.currency,
            timezoneName: acc.timezoneName,
            businessId: acc.businessId,
            status: acc.status,
          },
          create: {
            metaConnectionId: connection.id,
            accountId: acc.accountId,
            accountName: acc.accountName,
            currency: acc.currency,
            timezoneName: acc.timezoneName,
            businessId: acc.businessId,
            status: acc.status,
          },
        });
        upsertedAccounts.push(adAccount);
      }

      return NextResponse.json({
        success: true,
        accounts: upsertedAccounts,
      });
    } catch (apiError: any) {
      return NextResponse.json({
        success: false,
        error: apiError.message || 'Failed to fetch ad accounts',
      });
    }
  } catch (error: any) {
    console.error('Fetch accounts API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
