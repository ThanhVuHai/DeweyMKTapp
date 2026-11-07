import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const auth = await verifyAuth(request);
    return NextResponse.json({ user: auth.user });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json({ user: null });
  }
}
