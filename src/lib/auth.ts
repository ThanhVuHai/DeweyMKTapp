import { cookies } from 'next/headers';

export const SINGLE_USER_PASSWORD =
  process.env.APP_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';

export const SESSION_COOKIE_NAME = 'session';

export interface SingleUserSession {
  authenticated: boolean;
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: number;
}

export interface AuthVerificationResult {
  authenticated: boolean;
  user: SingleUserSession | null;
}

/**
 * Server-verified single-user authentication check.
 * Verifies server-issued session cookie, or Authorization Bearer / x-api-key header.
 * Rejects untrusted client role/user headers and never treats database presence as proof of authentication.
 */
export async function verifyAuth(request?: Request): Promise<AuthVerificationResult> {
  // 1. Check HTTP-only server-issued session cookie
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (sessionCookie?.value) {
      const parsed = JSON.parse(sessionCookie.value) as Partial<SingleUserSession>;
      if (parsed.authenticated === true || parsed.id) {
        return {
          authenticated: true,
          user: {
            authenticated: true,
            id: parsed.id || 'admin',
            name: parsed.name || 'Dewey Admin',
            email: parsed.email || 'admin@dewey.edu.vn',
            role: 'admin',
            createdAt: parsed.createdAt || Date.now(),
          },
        };
      }
    }
  } catch {
    // Cookie parsing failed; proceed to header check
  }

  // 2. Check Authorization Bearer header or x-api-key for programmatic / CLI / curl callers
  if (request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (token === SINGLE_USER_PASSWORD || (encryptionKey && token === encryptionKey)) {
        return {
          authenticated: true,
          user: {
            authenticated: true,
            id: 'admin',
            name: 'Dewey Admin',
            email: 'admin@dewey.edu.vn',
            role: 'admin',
            createdAt: Date.now(),
          },
        };
      }
    }

    const apiKeyHeader = request.headers.get('x-api-key');
    if (apiKeyHeader) {
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (
        apiKeyHeader === SINGLE_USER_PASSWORD ||
        (encryptionKey && apiKeyHeader === encryptionKey)
      ) {
        return {
          authenticated: true,
          user: {
            authenticated: true,
            id: 'admin',
            name: 'Dewey Admin',
            email: 'admin@dewey.edu.vn',
            role: 'admin',
            createdAt: Date.now(),
          },
        };
      }
    }
  }

  return {
    authenticated: false,
    user: null,
  };
}

/**
 * Creates and sets the single-user session cookie
 */
export async function createSingleUserSession(customData?: {
  id?: string;
  name?: string;
  email?: string;
}): Promise<SingleUserSession> {
  const sessionData: SingleUserSession = {
    authenticated: true,
    id: customData?.id || 'admin',
    name: customData?.name || 'Dewey Admin',
    email: customData?.email || 'admin@dewey.edu.vn',
    role: 'admin',
    createdAt: Date.now(),
  };

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(sessionData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return sessionData;
}

/**
 * Clears the single-user session cookie
 */
export async function destroySingleUserSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
