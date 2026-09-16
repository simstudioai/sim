import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import {
  attachRetryHeaders,
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
} from '@/lib/knowledge/documents/utils'
import { ConnectorSourceError } from '@/connectors/source-error'
import { readBodyWithLimit } from '@/connectors/utils'

const ERROR_BODY_MAX_BYTES = 64 * 1024
const MAX_REASONS = 16
/** Only known provider codes may reach logs; messages and unknown strings may contain data. */
const SAFE_REASONS = new Set([
  'accessNotConfigured',
  'appNotAuthorizedToFile',
  'authError',
  'backendError',
  'badRequest',
  'cannotDownloadFile',
  'cannotExportFile',
  'dailyLimitExceeded',
  'domainPolicy',
  'download_restricted_for_revision',
  'exportSizeLimitExceeded',
  'failedPrecondition',
  'fileNotDownloadable',
  'fileNotExportable',
  'forbidden',
  'insufficientFilePermissions',
  'insufficientPermissions',
  'internalError',
  'invalid',
  'invalidArgument',
  'notFound',
  'quotaExceeded',
  'rateLimitExceeded',
  'required',
  'serviceDisabled',
  'sharingRateLimitExceeded',
  'teamDriveMembershipRequired',
  'userRateLimitExceeded',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'API_KEY_SERVICE_BLOCKED',
  'SERVICE_DISABLED',
  'RATE_LIMIT_EXCEEDED',
  'USER_PROJECT_DENIED',
])
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
  'RATE_LIMIT_EXCEEDED',
])

export function safeGoogleErrorReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons.filter((reason) => SAFE_REASONS.has(reason)))]
}

/** Reads the bounded Google envelope without retaining provider messages or request data. */
export async function readGoogleErrorReasons(response: Response): Promise<string[]> {
  const body = await readBodyWithLimit(response, ERROR_BODY_MAX_BYTES).catch(() => null)
  if (!body) return []
  try {
    const payload: unknown = JSON.parse(body.toString('utf8'))
    if (!payload || typeof payload !== 'object' || !('error' in payload)) return []
    const error = payload.error
    if (!error || typeof error !== 'object') return []
    const entries = [
      ...('errors' in error && Array.isArray(error.errors) ? error.errors : []),
      ...('details' in error && Array.isArray(error.details) ? error.details : []),
    ]
    return safeGoogleErrorReasons(
      entries.flatMap((entry: unknown) =>
        entry && typeof entry === 'object' && 'reason' in entry && typeof entry.reason === 'string'
          ? [entry.reason]
          : []
      )
    )
  } catch {
    return []
  }
}

export class GoogleApiError extends ConnectorSourceError {
  readonly rateLimited: boolean
  retryAfterMs?: number
  constructor(operation: string, status: number, reasons: readonly string[]) {
    const safeReasons = safeGoogleErrorReasons(reasons)
    const suffix = safeReasons.length ? ` (${safeReasons.join(', ')})` : ''
    const category =
      status === 429 ||
      safeReasons.some(
        (reason) =>
          RATE_LIMIT_REASONS.has(reason) ||
          reason === 'dailyLimitExceeded' ||
          reason === 'quotaExceeded'
      )
        ? 'rate_limit'
        : status >= 500
          ? 'provider_unavailable'
          : undefined
    super(`${operation} failed (HTTP ${status})${suffix}.`, status, category, {
      operation,
      reasons: safeReasons.slice(0, MAX_REASONS),
    })
    this.name = 'GoogleApiError'
    this.rateLimited =
      status === 429 || safeReasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
  }
}

export async function readGoogleApiError(
  response: Response,
  operation: string
): Promise<GoogleApiError> {
  return new GoogleApiError(operation, response.status, await readGoogleErrorReasons(response))
}

/** Preserves Google diagnostics when the shared transport retries a transient HTTP response. */
function googleApiRetryOptions(operation: string, options: RetryOptions = {}): RetryOptions {
  return {
    ...options,
    fetcher: async (input, init, transport) => {
      const response = options.fetcher
        ? await options.fetcher(input, init, transport)
        : await transport(input, init)
      if (!response.ok) {
        const error = await readGoogleApiError(response, operation)
        attachRetryHeaders(error, response.headers)
        error.retryAfterMs = resolveRetryDelayMs(response.headers)
        throw error
      }
      return response
    },
    retryCondition: (error) =>
      error instanceof GoogleApiError && (error.status >= 500 || error.rateLimited)
        ? true
        : (options.retryCondition?.(error) ?? isRetryableError(error)),
  }
}

export function fetchGoogleApiWithRetry(
  operation: string,
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  return fetchWithRetry(url, options, googleApiRetryOptions(operation, retryOptions))
}
