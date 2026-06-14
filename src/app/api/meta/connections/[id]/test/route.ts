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
      // Run verification via Meta API
      const isValid = await MetaApiService.validateAccessToken({
        encryptedAccessToken: connection.encryptedAccessToken,
        graphApiVersion: connection.graphApiVersion,
      });

      if (isValid) {
        // Update connection status
        await prisma.metaConnection.update({
          where: { id: connection.id },
          data: {
            status: 'connected',
            lastTestedAt: new Date(),
          },
        });

        // If mock token, return mock success info
        const isMock = connection.encryptedAccessToken.includes('Fake') || connection.encryptedAccessToken.includes('mock-token');
        
        return NextResponse.json({
          success: true,
          message: 'Connected successfully',
          details: {
            accountName: isMock ? 'Dewey School Global Campaigns' : 'Meta Ads Connected Profile',
            accountId: isMock ? 'act_2938472948' : 'Available Accounts Loaded',
            currency: 'VND',
            timezone: 'Asia/Ho_Chi_Minh',
            permissions: ['ads_read', 'ads_management (Mocked)'],
          }
        });
      }

      throw new Error('Verification returned false');
    } catch (apiError: any) {
      const errorMsg = apiError.message || 'Unknown Meta API error';
      
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
        error: errorMsg,
      });
    }
  } catch (error: any) {
    console.error('Test connection API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
