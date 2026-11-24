/**
 * Preflight Guard for Database Isolation and System Health Verification
 * Protects Production database from accidental writes during Preview testing
 * and validates that Preview connects exclusively to the expected Neon branch endpoint.
 */

export type IsolationStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';

export interface DatabaseEndpointInfo {
  configured: boolean;
  isLocal: boolean;
  isNeon: boolean;
  isPooled: boolean;
  normalizedEndpointId: string;
  maskedHost: string;
  databaseName?: string;
}

export interface IsolationVerificationResult {
  status: IsolationStatus;
  isIsolated: boolean;
  actualEndpointId: string;
  expectedEndpointId: string | null;
  message: string;
  reason?: string;
}

/**
 * Normalizes a Neon endpoint identifier.
 * Strips protocol, username/password, -pooler suffix, and domain name.
 * Examples:
 *   "ep-summer-tree-123456-pooler.us-east-2.aws.neon.tech" -> "ep-summer-tree-123456"
 *   "ep-summer-tree-123456-pooler"                          -> "ep-summer-tree-123456"
 *   "ep-summer-tree-123456"                                 -> "ep-summer-tree-123456"
 */
export function normalizeNeonEndpointId(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();

  // If full URI is provided, extract the host part safely
  let hostPart = trimmed;
  if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      hostPart = parsed.hostname;
    } catch {
      // Fallback regex for URI with special characters
      const match = trimmed.match(/@([^/:?#]+)/);
      if (match) {
        hostPart = match[1];
      }
    }
  }

  // Extract the first subdomain segment (the endpoint prefix in Neon)
  const firstSubdomain = hostPart.split('.')[0] || '';
  
  // Strip "-pooler" suffix if present
  return firstSubdomain.replace(/-pooler$/i, '');
}

/**
 * Safely parses the effective DATABASE_URL and derives endpoint identity
 * without leaking usernames, passwords, or query string secrets.
 */
export function getDatabaseEndpointInfo(customUrl?: string): DatabaseEndpointInfo {
  const url = customUrl !== undefined ? customUrl : process.env.DATABASE_URL || '';

  if (!url) {
    return {
      configured: false,
      isLocal: false,
      isNeon: false,
      isPooled: false,
      normalizedEndpointId: '',
      maskedHost: '',
    };
  }

  // Handle local SQLite / file-based databases
  if (url.startsWith('file:') || url.includes('.db') || url.includes('sqlite')) {
    return {
      configured: true,
      isLocal: true,
      isNeon: false,
      isPooled: false,
      normalizedEndpointId: 'local-sqlite',
      maskedHost: 'local-file-dev.db',
      databaseName: 'dev.db',
    };
  }

  try {
    let hostname = '';
    let dbName = '';

    if (url.includes('://')) {
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
        dbName = parsed.pathname.replace(/^\//, '');
      } catch {
        const hostMatch = url.match(/@([^/:?#]+)/);
        if (hostMatch) hostname = hostMatch[1];
        const dbMatch = url.match(/\/([^/?#]+)(\?|$)/);
        if (dbMatch) dbName = dbMatch[1];
      }
    }

    const isNeon = hostname.includes('neon.tech');
    const isPooled = hostname.includes('-pooler');
    const normalizedEndpointId = normalizeNeonEndpointId(hostname);

    // Create a safe, redacted representation of the hostname
    // Example: "ep-sum***123456.us-east-2.aws.neon.tech"
    let maskedHost = hostname;
    if (normalizedEndpointId && normalizedEndpointId.length > 8) {
      const prefix = normalizedEndpointId.slice(0, 5);
      const suffix = normalizedEndpointId.slice(-4);
      maskedHost = hostname.replace(normalizedEndpointId, `${prefix}***${suffix}`);
    }

    return {
      configured: true,
      isLocal: false,
      isNeon,
      isPooled,
      normalizedEndpointId,
      maskedHost,
      databaseName: dbName || undefined,
    };
  } catch {
    return {
      configured: true,
      isLocal: false,
      isNeon: false,
      isPooled: false,
      normalizedEndpointId: 'unknown-remote',
      maskedHost: 'redacted-database-host',
    };
  }
}

/**
 * Compares the effective database endpoint identity derived from DATABASE_URL
 * against an expected endpoint ID (e.g. from EXPECTED_NEON_ENDPOINT_ID).
 * Returns PASS, FAIL, or NOT_VERIFIED.
 */
export function verifyDatabaseIsolation(options?: {
  expectedEndpointId?: string | null;
  databaseUrl?: string;
}): IsolationVerificationResult {
  const expectedRaw =
    options?.expectedEndpointId !== undefined
      ? options.expectedEndpointId
      : process.env.EXPECTED_NEON_ENDPOINT_ID;

  const endpointInfo = getDatabaseEndpointInfo(options?.databaseUrl);

  const normActual = endpointInfo.normalizedEndpointId;
  const normExpected = normalizeNeonEndpointId(expectedRaw);

  // Case 1: EXPECTED_NEON_ENDPOINT_ID is missing or empty
  if (!normExpected) {
    if (endpointInfo.isLocal) {
      return {
        status: 'NOT_VERIFIED',
        isIsolated: false,
        actualEndpointId: normActual,
        expectedEndpointId: null,
        message: 'Môi trường local SQLite. Chưa thiết lập EXPECTED_NEON_ENDPOINT_ID.',
        reason: 'MISSING_EXPECTED_ENDPOINT',
      };
    }
    return {
      status: 'NOT_VERIFIED',
      isIsolated: false,
      actualEndpointId: normActual,
      expectedEndpointId: null,
      message:
        'Chưa cấu hình biến EXPECTED_NEON_ENDPOINT_ID trên Vercel Preview. Hãy đặt biến này bằng Endpoint ID của nhánh Neon dewey-mkt-preview để kiểm chứng cách ly.',
      reason: 'MISSING_EXPECTED_ENDPOINT',
    };
  }

  // Case 2: Database not configured
  if (!endpointInfo.configured) {
    return {
      status: 'FAIL',
      isIsolated: false,
      actualEndpointId: '',
      expectedEndpointId: normExpected,
      message: 'DATABASE_URL chưa được thiết lập.',
      reason: 'DATABASE_URL_NOT_CONFIGURED',
    };
  }

  // Case 3: Actual matches expected
  if (normActual && normActual === normExpected) {
    return {
      status: 'PASS',
      isIsolated: true,
      actualEndpointId: normActual,
      expectedEndpointId: normExpected,
      message: `Đã xác minh cách ly an toàn! Database thực tế kết nối chính xác tới Neon Preview Endpoint: ${normActual}.`,
    };
  }

  // Case 4: Mismatch! Dangerous condition
  return {
    status: 'FAIL',
    isIsolated: false,
    actualEndpointId: normActual,
    expectedEndpointId: normExpected,
    message: `CẢNH BÁO NGUY CƠ: Database thực tế (${normActual || 'unknown'}) KHÔNG KHỚP với Preview Endpoint kỳ vọng (${normExpected})! Đã kích hoạt chốt khóa an toàn chặn mọi tác vụ ghi dữ liệu.`,
    reason: 'ENDPOINT_MISMATCH',
  };
}

/**
 * Task 2 Server-Side Write Protection Guard.
 * Fails closed if database isolation check is not PASS.
 */
export function assertDatabaseIsolation(options?: {
  expectedEndpointId?: string | null;
  databaseUrl?: string;
}): void {
  const result = verifyDatabaseIsolation(options);
  if (result.status !== 'PASS') {
    throw new Error(
      `[SECURITY WRITE GUARD BLOCKED]: Không thể ghi dữ liệu vì kiểm tra cách ly Database chưa đạt PASS. Trạng thái hiện tại: ${result.status} (${result.message})`
    );
  }
}
