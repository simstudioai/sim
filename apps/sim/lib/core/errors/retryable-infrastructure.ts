import { toError } from '@sim/utils/errors'

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

export interface DescribedError {
  name: string
  message: string
  code?: string
  errno?: string
  syscall?: string
  /** `"Name: message"` per link in the `.cause` chain, outermost first. Present only when the chain has more than one link. */
  causeChain?: string[]
}

/**
 * Always-on diagnostic view of an error and its `.cause` chain.
 *
 * Unlike {@link describeRetryableInfrastructureError} — which returns
 * `undefined` for errors outside its retryable allowlist — this returns the
 * underlying cause for ANY error, including `AbortError` and otherwise
 * unclassified causes. Reports the fields of the DEEPEST `.cause` link, because
 * a wrapped driver error (e.g. Drizzle's `"Failed query: ..."` wrapping an
 * `ECONNRESET`) carries the real reason there, not on the outer wrapper.
 *
 * `@sim/logger` does not serialize the non-enumerable `Error.prototype.cause`,
 * so callers must pass the result as an explicit structured log field rather
 * than relying on the logger to expand a raw error.
 */
export function describeError(error: unknown): DescribedError {
  const chain = getErrorChain(error)
  if (chain.length === 0) {
    const normalized = toError(error)
    return { name: normalized.name, message: normalized.message }
  }
  const deepest = chain[chain.length - 1]
  const code = typeof deepest.code === 'string' ? deepest.code : undefined
  const errno = typeof deepest.errno === 'string' ? deepest.errno : undefined
  const syscall = typeof deepest.syscall === 'string' ? deepest.syscall : undefined
  return {
    name: deepest.name,
    message: deepest.message,
    ...(code ? { code } : {}),
    ...(errno ? { errno } : {}),
    ...(syscall ? { syscall } : {}),
    ...(chain.length > 1 ? { causeChain: chain.map((e) => `${e.name}: ${e.message}`) } : {}),
  }
}
