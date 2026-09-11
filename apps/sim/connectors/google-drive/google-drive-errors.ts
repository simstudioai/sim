import {
  attachRetryHeaders,
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'
import {
  ConnectorSourceError,
  type ConnectorSourceFailureCategory,
} from '@/connectors/source-error'
import { readBodyWithLimit } from '@/connectors/utils'

const GOOGLE_ERROR_BODY_MAX_BYTES = 64 * 1024
const GOOGLE_ERROR_REASON_MAX_COUNT = 16

const EXPORT_TOO_LARGE_REASONS = new Set(['exportSizeLimitExceeded'])
const PERMISSION_REASONS = new Set([
  'appNotAuthorizedToFile',
  'insufficientFilePermissions',
  'teamDriveMembershipRequired',
])
/**
 * Owner- or admin-imposed restrictions on an otherwise readable file. The
 * credential is valid, so these are not authorization failures; `cannotExportFile`
 * and `cannotDownloadFile` are what Drive returns when the owner disabled
 * download, print, and copy for viewers.
 */
const POLICY_REASONS = new Set([
  'domainPolicy',
  'download_restricted_for_revision',
  'cannotDownloadFile',
  'cannotExportFile',
])
const UNSUPPORTED_EXPORT_REASONS = new Set(['fileNotDownloadable', 'fileNotExportable'])
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded'])
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'sharingRateLimitExceeded',
  'userRateLimitExceeded',
])
const TRANSIENT_REASONS = new Set(['backendError', 'internalError', ...RATE_LIMIT_REASONS])

export type GoogleDriveErrorKind =
  | 'authorization'
  | 'export_too_large'
  | 'not_found'
  | 'permission'
  | 'policy'
  | 'quota'
  | 'transient'
  | 'unknown'
  | 'unsupported_export'

interface GoogleErrorEntry {
  reason?: string
}

interface ParsedGoogleErrorBody {
  error?: {
    errors?: GoogleErrorEntry[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseErrorBody(value: unknown): ParsedGoogleErrorBody | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined

  const entries = Array.isArray(value.error.errors)
    ? value.error.errors.flatMap((entry): GoogleErrorEntry[] => {
        if (!isRecord(entry)) return []
        return [
          {
            reason: optionalString(entry.reason),
          },
        ]
      })
    : undefined

  return {
    error: {
      errors: entries,
    },
  }
}

function normalizeReason(reason: string): string | undefined {
  const normalized = reason.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(normalized) ? normalized : undefined
}

function classifyGoogleDriveError(
  status: number,
  reasons: readonly string[]
): GoogleDriveErrorKind {
  if (status === 429 || status >= 500) return 'transient'
  if (reasons.some((reason) => EXPORT_TOO_LARGE_REASONS.has(reason))) {
    return 'export_too_large'
  }
  if (status === 404 || reasons.includes('notFound')) return 'not_found'
  if (status === 401 || reasons.includes('authError')) return 'authorization'
  if (reasons.some((reason) => PERMISSION_REASONS.has(reason))) return 'permission'
  if (reasons.some((reason) => POLICY_REASONS.has(reason))) return 'policy'
  if (reasons.some((reason) => UNSUPPORTED_EXPORT_REASONS.has(reason))) {
    return 'unsupported_export'
  }
  if (reasons.some((reason) => QUOTA_REASONS.has(reason))) return 'quota'
  if (reasons.some((reason) => TRANSIENT_REASONS.has(reason))) {
    return 'transient'
  }
  return 'unknown'
}

function diagnosticCategory(
  kind: GoogleDriveErrorKind,
  status: number
): ConnectorSourceFailureCategory | undefined {
  switch (kind) {
    case 'authorization':
    case 'permission':
      return 'authorization'
    case 'not_found':
      return 'source_unavailable'
    case 'export_too_large':
    case 'unsupported_export':
    case 'policy':
      return 'request_rejected'
    case 'quota':
      return 'rate_limit'
    case 'transient':
      return status === 429 || status === 403 ? 'rate_limit' : 'provider_unavailable'
    default:
      return undefined
  }
}

export class GoogleDriveApiError extends ConnectorSourceError {
  retryAfterMs?: number
  readonly reasons: readonly string[]
  readonly kind: GoogleDriveErrorKind
  readonly rateLimited: boolean

  constructor(status: number, normalizedReasons: readonly string[]) {
    const diagnosticReasons = normalizedReasons.slice(0, GOOGLE_ERROR_REASON_MAX_COUNT)
    const reasonSuffix = diagnosticReasons.length > 0 ? ` (${diagnosticReasons.join(', ')})` : ''
    const kind = classifyGoogleDriveError(status, normalizedReasons)
    super(
      `Google Drive API request failed with HTTP ${status}${reasonSuffix}`,
      status,
      diagnosticCategory(kind, status)
    )
    this.name = 'GoogleDriveApiError'
    this.reasons = diagnosticReasons
    this.kind = kind
    this.rateLimited =
      status === 429 || normalizedReasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
  }
}

/**
 * Parses Google's structured error envelope without retaining or logging the raw
 * response body. Error payloads are byte-bounded, free-form provider messages
 * are omitted, and only validated machine-readable reason tokens survive.
 */
export async function readGoogleDriveApiError(response: Response): Promise<GoogleDriveApiError> {
  const body = await readBodyWithLimit(response, GOOGLE_ERROR_BODY_MAX_BYTES).catch(() => null)
  let parsedBody: ParsedGoogleErrorBody | undefined

  if (body) {
    try {
      parsedBody = parseErrorBody(JSON.parse(body.toString('utf8')))
    } catch {
      parsedBody = undefined
    }
  }

  const entries = parsedBody?.error?.errors ?? []
  const rawReasons = [...new Set(entries.flatMap((entry) => (entry.reason ? [entry.reason] : [])))]
  const normalizedReasons = [
    ...new Set(rawReasons.flatMap((reason) => normalizeReason(reason) ?? [])),
  ]
  return new GoogleDriveApiError(response.status, normalizedReasons)
}

/**
 * Fetches a Google API, retrying errors whose structured body identifies a
 * transient rejection. Shared by every Google call a connector makes — Drive
 * and the Admin SDK use the same error envelope and the same rate-limit
 * reasons.
 */
export async function fetchGoogleDriveWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  return retryWithExponentialBackoff(
    async () => {
      const response = await fetch(url, options)
      if (response.ok) return response

      const error = await readGoogleDriveApiError(response)
      attachRetryHeaders(error, response.headers)
      const waitMs = resolveRetryDelayMs(response.headers)
      if (waitMs !== undefined) error.retryAfterMs = waitMs
      throw error
    },
    {
      ...retryOptions,
      retryCondition: (error) =>
        error instanceof GoogleDriveApiError
          ? error.kind === 'transient' || isRetryableError(error)
          : (retryOptions.retryCondition?.(error) ?? isRetryableError(error)),
    }
  )
}
