import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import {
  attachRetryHeaders,
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
} from '@/lib/knowledge/documents/utils'
import { ConnectorSourceError, type ConnectorSourceReasonState } from '@/connectors/source-error'
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

/** Distinguishes a reasonless envelope from one whose reason codes cannot safely be interpreted. */
export async function readGoogleErrorDetails(
  response: Response
): Promise<{ reasons: string[]; complete: boolean; reasonState: ConnectorSourceReasonState }> {
  const unreadable = { reasons: [], complete: false, reasonState: 'unreadable' as const }
  const malformed = { reasons: [], complete: false, reasonState: 'malformed' as const }
  const body = await readBodyWithLimit(response, ERROR_BODY_MAX_BYTES).catch(() => null)
  if (!body) return unreadable
  try {
    const payload: unknown = JSON.parse(body.toString('utf8'))
    if (!payload || typeof payload !== 'object' || !('error' in payload)) return malformed
    const error = payload.error
    if (!error || typeof error !== 'object' || Array.isArray(error)) return malformed
    const envelopeValid =
      (!('errors' in error) || Array.isArray(error.errors)) &&
      (!('details' in error) || Array.isArray(error.details))
    const entries = [
      ...('errors' in error && Array.isArray(error.errors) ? error.errors : []),
      ...('details' in error && Array.isArray(error.details) ? error.details : []),
    ]
    const reasons = entries.flatMap((entry: unknown) =>
      entry && typeof entry === 'object' && 'reason' in entry && typeof entry.reason === 'string'
        ? [entry.reason]
        : []
    )
    const safeReasons = safeGoogleErrorReasons(reasons)
    const validReasons =
      envelopeValid &&
      (entries.length > 0 || ('code' in error && error.code === response.status)) &&
      reasons.length === entries.length
    const reasonState: ConnectorSourceReasonState = !validReasons
      ? 'malformed'
      : reasons.some((reason) => !SAFE_REASONS.has(reason)) || safeReasons.length > MAX_REASONS
        ? 'filtered'
        : reasons.length === 0
          ? 'absent'
          : 'present'
    return {
      reasons: safeReasons,
      complete: reasonState === 'present' || reasonState === 'absent',
      reasonState,
    }
  } catch {
    return malformed
  }
}

export class GoogleApiError extends ConnectorSourceError {
  readonly rateLimited: boolean
  readonly reasonsComplete: boolean
  retryAfterMs?: number
  constructor(
    operation: string,
    status: number,
    reasons: readonly string[],
    reasonsComplete = true,
    reasonState?: ConnectorSourceReasonState
  ) {
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
      ...(reasonState ? { reasonState } : {}),
    })
    this.name = 'GoogleApiError'
    this.reasonsComplete =
      reasonsComplete &&
      reasons.every((reason) => SAFE_REASONS.has(reason)) &&
      safeReasons.length <= MAX_REASONS
    this.rateLimited =
      status === 429 || safeReasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
  }
}

export async function readGoogleApiError(
  response: Response,
  operation: string
): Promise<GoogleApiError> {
  const details = await readGoogleErrorDetails(response)
  return new GoogleApiError(
    operation,
    response.status,
    details.reasons,
    details.complete,
    details.reasonState
  )
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
