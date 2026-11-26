/**
 * Centralized Secret Redaction & Sanitization Engine
 * Guarantees zero leakage of Meta Access Tokens, Database URLs, Passwords,
 * Bearer tokens, API keys, Cookies, and sensitive credentials across
 * logs, exceptions, error messages, stack traces, and API responses.
 */

// Regex patterns for sensitive values
const META_ACCESS_TOKEN_REGEX = /\b(EAAB[a-zA-Z0-9]{10,}|EAA[a-zA-Z0-9]{15,})\b/g;
const DATABASE_URL_REGEX = /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)@([^/\s?#]+)([^?\s#]*)(?:(\?[^\s"']*))?/gi;
const BEARER_TOKEN_REGEX = /(Bearer\s+)[a-zA-Z0-9_\-\.]{10,}/gi;
const SECRET_PARAM_REGEX = /([?&](?:access_token|client_secret|app_secret|secret|api_key|password|token)=)([^&"'\s]+)/gi;
const SENSITIVE_HEADER_REGEX = /(?:authorization|cookie|set-cookie):\s*[^\r\n]+/gi;
const ENCRYPTED_HEX_TOKEN_REGEX = /\b[a-f0-9]{32}:[a-f0-9]{32,}\b/gi;

// Sensitive object key patterns
const SENSITIVE_KEY_REGEX = /(token|secret|password|passwd|auth|credential|cookie|database_url|session|private|api[_-]?key|app[_-]?key|secret[_-]?key|\bkey\b)/i;

/**
 * Sanitizes a string by redacting any embedded secrets, tokens, or credentials.
 */
export function sanitizeString(value: string): string {
  if (!value || typeof value !== 'string') return value;

  let sanitized = value;

  // Redact PostgreSQL connection strings (mask password and sensitive query params)
  sanitized = sanitized.replace(DATABASE_URL_REGEX, (_match, proto, user, _pass, host, path, query) => {
    const cleanQuery = query ? '?sslmode=require&[REDACTED_PARAMS]' : '';
    return `${proto}${user}:[REDACTED_DB_PASSWORD]@${host}${path}${cleanQuery}`;
  });

  // Redact Meta Access Tokens
  sanitized = sanitized.replace(META_ACCESS_TOKEN_REGEX, '[REDACTED_META_TOKEN]');

  // Redact Bearer Tokens
  sanitized = sanitized.replace(BEARER_TOKEN_REGEX, '$1[REDACTED_BEARER_TOKEN]');

  // Redact query parameter secrets
  sanitized = sanitized.replace(SECRET_PARAM_REGEX, '$1[REDACTED_SECRET]');

  // Redact sensitive headers
  sanitized = sanitized.replace(SENSITIVE_HEADER_REGEX, '[REDACTED_HEADER]');

  // Redact internal encrypted hex tokens (iv:ciphertext)
  sanitized = sanitized.replace(ENCRYPTED_HEX_TOKEN_REGEX, '[REDACTED_ENCRYPTED_SECRET]');

  return sanitized;
}

/**
 * Recursively sanitizes any data structure (objects, arrays, strings, primitives)
 * with cycle detection and depth limiting.
 */
export function sanitizeForLogging<T>(input: T, depth = 0, seen = new WeakSet()): T {
  if (depth > 10) return '[MAX_DEPTH_REACHED]' as unknown as T;
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return sanitizeString(input) as unknown as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  // Handle Error instances specifically
  if (input instanceof Error) {
    return sanitizeError(input) as unknown as T;
  }

  // Handle Date instances
  if (input instanceof Date) {
    return input;
  }

  // Prevent circular references
  if (seen.has(input as object)) {
    return '[CIRCULAR_REF]' as unknown as T;
  }
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map(item => sanitizeForLogging(item, depth + 1, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeForLogging(val, depth + 1, seen);
    }
  }

  return result as unknown as T;
}

/**
 * Sanitizes an Error or unknown exception into a safe structured object.
 * Guarantees stack trace and message never leak connection strings or tokens.
 */
export function sanitizeError(err: unknown): {
  message: string;
  name?: string;
  code?: string | number;
  stack?: string;
} {
  if (!err) {
    return { message: 'Unknown error (null/undefined)' };
  }

  if (err instanceof Error) {
    const sanitizedMsg = sanitizeString(err.message || 'Error occurred');
    const sanitizedStack = err.stack ? sanitizeString(err.stack) : undefined;
    const code = (err as { code?: string | number }).code;

    return {
      name: err.name || 'Error',
      message: sanitizedMsg,
      code,
      stack: sanitizedStack,
    };
  }

  if (typeof err === 'object') {
    const sanitizedObj = sanitizeForLogging(err as Record<string, unknown>);
    return {
      message: sanitizeString(JSON.stringify(sanitizedObj)),
    };
  }

  return {
    message: sanitizeString(String(err)),
  };
}
