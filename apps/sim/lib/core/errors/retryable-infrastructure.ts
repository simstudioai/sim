const RETRYABLE_DB_ERROR_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '53300',
  '53400',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '58000',
  '58030',
])

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

const RETRYABLE_APP_ERROR_CODES = new Set([
  'SERVICE_OVERLOADED',
  'RESOURCE_EXHAUSTED',
  'CONNECTION_POOL_EXHAUSTED',
])

/**
 * postgres.js raises connection-level failures with its own `code` values
 * rather than Node syscall codes: `CONNECT_TIMEOUT` when a connection cannot
 * be established within `connect_timeout`, `CONNECTION_CLOSED` when the socket
 * drops with queries pending, `CONNECTION_ENDED`/`CONNECTION_DESTROYED` when
 * the pool is shut down or torn down underneath a query. All mean the query
 * did not complete against a reachable server — the same class as
 * `ECONNRESET`/`ETIMEDOUT` above.
 */
const RETRYABLE_PG_CLIENT_ERROR_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
])

function getErrorChain(error: unknown): Array<Error & Record<string, unknown>> {
  const chain: Array<Error & Record<string, unknown>> = []
  let current: unknown = error
  for (let depth = 0; depth < 10 && current instanceof Error; depth++) {
    const candidate = current as Error & Record<string, unknown>
    chain.push(candidate)
    current = candidate.cause
  }
  return chain
}

export function describeRetryableInfrastructureError(
  error: unknown
): Record<string, unknown> | undefined {
  for (const candidate of getErrorChain(error)) {
    const code = typeof candidate.code === 'string' ? candidate.code : undefined
    const errno = typeof candidate.errno === 'string' ? candidate.errno : undefined
    const syscall = typeof candidate.syscall === 'string' ? candidate.syscall : undefined

    if (
      (code && RETRYABLE_DB_ERROR_CODES.has(code)) ||
      (code && RETRYABLE_NETWORK_ERROR_CODES.has(code)) ||
      (code && RETRYABLE_APP_ERROR_CODES.has(code)) ||
      (code && RETRYABLE_PG_CLIENT_ERROR_CODES.has(code)) ||
      (errno && RETRYABLE_NETWORK_ERROR_CODES.has(errno))
    ) {
      return {
        name: candidate.name,
        message: candidate.message,
        code,
        errno,
        syscall,
      }
    }
  }

  return undefined
}

export function isRetryableInfrastructureError(error: unknown): boolean {
  return Boolean(describeRetryableInfrastructureError(error))
}

/**
 * A retryable infrastructure failure raised strictly BEFORE the guarded
 * operation performed any effect (no workflow block ran, no mutation
 * committed). Throwing it is a contract:
 *
 * - the whole operation may be safely re-attempted from scratch, and
 * - {@link IdempotencyService.executeWithIdempotency} releases the claim
 *   instead of memoizing the failure, so a re-attempt (or a provider
 *   redelivery) can claim and run rather than being rejected for the
 *   result TTL.
 *
 * Only construct one at a point where the "no effect yet" invariant is
 * provable — e.g. behind a `workflowCoreStarted` guard.
 */
export class RetryableSetupError extends Error {
  readonly isRetryableSetup = true as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RetryableSetupError'
  }
}

export function isRetryableSetupError(error: unknown): error is RetryableSetupError {
  return error instanceof Error && (error as Partial<RetryableSetupError>).isRetryableSetup === true
}
