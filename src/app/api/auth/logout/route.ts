import { NextResponse } from 'next/server';
import { destroySingleUserSession } from '@/lib/auth';

export async function POST() {
  await destroySingleUserSession();
  return NextResponse.json({ success: true });
}
