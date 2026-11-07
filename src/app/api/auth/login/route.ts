import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SINGLE_USER_PASSWORD, createSingleUserSession } from '@/lib/auth';

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
    let userName = 'Dewey Admin';
    let userEmail = email || 'admin@dewey.edu.vn';
    let userId = 'admin';

    // If not matching env password directly, check database single-user record if present
    if (!isValid && email) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { email },
        });
        if (dbUser && dbUser.passwordHash === password) {
          isValid = true;
          userName = dbUser.name;
          userEmail = dbUser.email;
          userId = dbUser.id;
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

    const sessionData = await createSingleUserSession({
      id: userId,
      name: userName,
      email: userEmail,
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
