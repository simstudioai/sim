import { vi } from 'vitest'

/** Copied from the real module: scanned with string/identifier literals masked out. */
const SQL_WHERE_MASKED_PATTERNS: readonly RegExp[] = [
  /;\s*\w/,
  /\bunion\s+(?:all\s+)?select\b/i,
  /\binto\s+(?:out|dump)file\b/i,
  /--/,
  /\/\*/,
  /\*\//,
  /\b(?:sleep|pg_sleep|benchmark)\s*\(/i,
  /\b(\w+)\s*=\s*\1\b/i,
  /\b\d+(?:\.\d+)?\s*(?:=|==|<>|!=|<=|>=|<|>)\s*\d+(?:\.\d+)?\b/,
  /\bor\s+(?:true|false)\b/i,
  /\bor\s+\d+(?:\.\d+)?\b(?!\s*[=<>!+\-*/%])/i,
  /^\s*(?:\d+(?:\.\d+)?|true|false)\s*$/i,
]

/** Copied from the real module: scanned against the raw clause. */
const SQL_WHERE_RAW_PATTERNS: readonly RegExp[] = [/(['"])([^'"]*)\1\s*(?:=|==|<>|!=)\s*\1\2\1/]

/** Faithful copy of the real `maskSqlStringLiterals`. */
function maskSqlStringLiterals(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ' '
      i++
      while (i < sql.length && sql[i] !== ch) {
        if (ch !== '`' && sql[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += ' '
        i++
      }
      if (i < sql.length) {
        out += ' '
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Faithful copy of the real `validateSqlWhereClause`. */
function validateSqlWhereClause(
  where: string | null | undefined,
  paramName = 'WHERE clause'
): { isValid: boolean; error?: string } {
  if (typeof where !== 'string' || where.trim().length === 0) {
    return { isValid: false, error: `${paramName} is required` }
  }
  const masked = maskSqlStringLiterals(where)
  const matched =
    SQL_WHERE_MASKED_PATTERNS.some((pattern) => pattern.test(masked)) ||
    SQL_WHERE_RAW_PATTERNS.some((pattern) => pattern.test(where))
  if (matched) {
    return {
      isValid: false,
      error: `${paramName} contains a disallowed or always-true expression`,
    }
  }
  return { isValid: true }
}

/** Faithful copy of the real `SecureFetchHeaders` (case-insensitive header bag). */
class SecureFetchHeaders {
  private headers: Map<string, string>
  private setCookies: string[]

  constructor(headers: Record<string, string> = {}, setCookies: string[] = []) {
    this.headers = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    this.setCookies = setCookies
  }

  get(name: string): string | null {
    return this.headers.get(name.toLowerCase()) ?? null
  }

  getSetCookie(): string[] {
    return [...this.setCookies]
  }

  toRecord(): Record<string, string> {
    const record: Record<string, string> = {}
    for (const [key, value] of this.headers) {
      record[key] = value
    }
    return record
  }

  [Symbol.iterator]() {
    return this.headers.entries()
  }
}

/**
 * Controllable mock functions for `@/lib/core/security/input-validation.server`.
 *
 * Network-facing functions (`validateUrlWithDNS`, `secureFetch*`, `createPinned*`,
 * `createSsrfGuarded*`, `followRedirectsGuarded`, `validateDatabaseHost`) are bare
 * `vi.fn()`s — set what each test needs. `createPinnedConnectionPool` defaults to a pool
 * whose `agent()` returns `undefined`. `maskSqlStringLiterals` and `validateSqlWhereClause`
 * default to the real pure logic.
 *
 * @example
 * ```ts
 * import { inputValidationMockFns } from '@sim/testing'
 *
 * inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
 * inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 200 })
 * ```
 */
export const inputValidationMockFns = {
  mockValidateUrlWithDNS: vi.fn(),
  mockValidateAndPinProxyUrl: vi.fn(),
  mockValidateDatabaseHost: vi.fn(),
  mockMaskSqlStringLiterals: vi.fn(maskSqlStringLiterals),
  mockValidateSqlWhereClause: vi.fn(validateSqlWhereClause),
  mockCreatePinnedConnectionPool: vi.fn(() => ({ agent: vi.fn(), destroy: vi.fn() })),
  mockCreatePinnedLookup: vi.fn(),
  mockCreateSsrfGuardedLookup: vi.fn(),
  mockFollowRedirectsGuarded: vi.fn(),
  mockCreateSsrfGuardedFetchWithDispatcher: vi.fn(),
  mockCreatePinnedFetch: vi.fn(),
  mockCreatePinnedFetchWithDispatcher: vi.fn(),
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockSecureFetchWithValidation: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/security/input-validation.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
 * ```
 */
export const inputValidationMock = {
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  validateUrlWithDNS: inputValidationMockFns.mockValidateUrlWithDNS,
  validateAndPinProxyUrl: inputValidationMockFns.mockValidateAndPinProxyUrl,
  validateDatabaseHost: inputValidationMockFns.mockValidateDatabaseHost,
  maskSqlStringLiterals: inputValidationMockFns.mockMaskSqlStringLiterals,
  validateSqlWhereClause: inputValidationMockFns.mockValidateSqlWhereClause,
  createPinnedConnectionPool: inputValidationMockFns.mockCreatePinnedConnectionPool,
  createPinnedLookup: inputValidationMockFns.mockCreatePinnedLookup,
  createSsrfGuardedLookup: inputValidationMockFns.mockCreateSsrfGuardedLookup,
  followRedirectsGuarded: inputValidationMockFns.mockFollowRedirectsGuarded,
  createSsrfGuardedFetchWithDispatcher:
    inputValidationMockFns.mockCreateSsrfGuardedFetchWithDispatcher,
  createPinnedFetch: inputValidationMockFns.mockCreatePinnedFetch,
  createPinnedFetchWithDispatcher: inputValidationMockFns.mockCreatePinnedFetchWithDispatcher,
  secureFetchWithPinnedIP: inputValidationMockFns.mockSecureFetchWithPinnedIP,
  secureFetchWithValidation: inputValidationMockFns.mockSecureFetchWithValidation,
  SecureFetchHeaders,
}
