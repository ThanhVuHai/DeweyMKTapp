import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SINGLE_USER_PASSWORD, createSingleUserSession, getOrCreateSingleUser } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { password, email } = body;

    if (!password) {
      return NextResponse.json(
        { error: 'Vui lòng nhập mật khẩu truy cập' },
        { status: 400 }
      );
    }

    let isValid = password === SINGLE_USER_PASSWORD;

    // Check database single-user record if present
    if (!isValid && email) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { email },
        });
        if (dbUser && dbUser.passwordHash === password) {
          isValid = true;
        }
      } catch {
        // Fallback check error
      }
    }

    if (!isValid) {
      return NextResponse.json(
        { error: 'Mật khẩu không chính xác. Vui lòng thử lại.' },
        { status: 401 }
      );
    }

    // Resolves or creates a valid persisted user in the database
    const ownerUser = await getOrCreateSingleUser();

    const sessionData = await createSingleUserSession({
      id: ownerUser.id,
      name: ownerUser.name,
      email: ownerUser.email,
    });

    return NextResponse.json({
      success: true,
      user: sessionData,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Lỗi đăng nhập: ' + message },
      { status: 500 }
    );
  }
}
