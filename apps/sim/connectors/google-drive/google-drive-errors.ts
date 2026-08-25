import { truncate } from '@sim/utils/string'
import { redactSensitiveValues } from '@/lib/core/security/redaction'
import { readBodyWithLimit } from '@/connectors/utils'

const GOOGLE_ERROR_BODY_MAX_BYTES = 64 * 1024
const GOOGLE_ERROR_MESSAGE_MAX_LENGTH = 500
const GOOGLE_ERROR_REASON_MAX_COUNT = 16
const GOOGLE_ERROR_REASON_MAX_LENGTH = 100

const EXPORT_TOO_LARGE_REASONS = new Set(['exportSizeLimitExceeded'])
const PERMISSION_REASONS = new Set([
  'appNotAuthorizedToFile',
  'insufficientFilePermissions',
  'teamDriveMembershipRequired',
])
const POLICY_REASONS = new Set(['domainPolicy', 'download_restricted_for_revision'])
const UNSUPPORTED_EXPORT_REASONS = new Set(['fileNotDownloadable', 'fileNotExportable'])
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded'])
const TRANSIENT_REASONS = new Set([
  'backendError',
  'internalError',
  'rateLimitExceeded',
  'sharingRateLimitExceeded',
  'userRateLimitExceeded',
])

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
  message?: string
  reason?: string
}

interface ParsedGoogleErrorBody {
  error?: {
    errors?: GoogleErrorEntry[]
    message?: string
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
            message: optionalString(entry.message),
            reason: optionalString(entry.reason),
          },
        ]
      })
    : undefined

  return {
    error: {
      errors: entries,
      message: optionalString(value.error.message),
    },
  }
}

function normalizeMessage(message: string | undefined): string | undefined {
  if (!message) return undefined
  const singleLine = message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return singleLine
    ? truncate(redactSensitiveValues(singleLine), GOOGLE_ERROR_MESSAGE_MAX_LENGTH, '')
    : undefined
}

function normalizeReason(reason: string): string | undefined {
  const singleLine = reason
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!singleLine) return undefined
  return truncate(redactSensitiveValues(singleLine), GOOGLE_ERROR_REASON_MAX_LENGTH, '')
}

function classifyGoogleDriveError(
  status: number,
  reasons: readonly string[]
): GoogleDriveErrorKind {
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
  if (status === 429 || status >= 500 || reasons.some((reason) => TRANSIENT_REASONS.has(reason))) {
    return 'transient'
  }
  return 'unknown'
}

export class GoogleDriveApiError extends Error {
  constructor(
    readonly status: number,
    readonly reasons: readonly string[],
    readonly kind: GoogleDriveErrorKind,
    readonly providerMessage?: string
  ) {
    const reasonSuffix = reasons.length > 0 ? ` (${reasons.join(', ')})` : ''
    super(`Google Drive API request failed with HTTP ${status}${reasonSuffix}`)
    this.name = 'GoogleDriveApiError'
  }
}

/**
 * Parses Google's structured error envelope without retaining or logging the raw
 * response body. Error payloads are byte-bounded and provider messages are reduced
 * to a single capped line before they can reach diagnostics.
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
  const reasons = [...new Set(rawReasons.flatMap((reason) => normalizeReason(reason) ?? []))].slice(
    0,
    GOOGLE_ERROR_REASON_MAX_COUNT
  )
  const providerMessage = normalizeMessage(
    parsedBody?.error?.message ?? entries.find((entry) => entry.message)?.message
  )

  return new GoogleDriveApiError(
    response.status,
    reasons,
    classifyGoogleDriveError(response.status, rawReasons),
    providerMessage
  )
}
