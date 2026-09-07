/**
 * Error Extractor Registry
 *
 * This module provides a clean, config-based approach to extracting error messages
 * from diverse API error response formats.
 *
 * ## Adding a new extractor
 *
 * 1. Add entry to ERROR_EXTRACTORS array below:
 * ```typescript
 * {
 *   id: 'stripe-errors',
 *   description: 'Stripe API error format',
 *   examples: ['Stripe API'],
 *   extract: (errorInfo) => errorInfo?.data?.error?.message
 * }
 * ```
 *
 * 2. Add the ID to ErrorExtractorId constant at the bottom of this file
 */

import { parseGraphErrorFromData } from '@/tools/microsoft_excel/utils'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'

export interface ErrorInfo {
  status?: number
  statusText?: string
  data?: any
}

export type ErrorExtractor = (errorInfo?: ErrorInfo) => string | null | undefined

interface ErrorExtractorConfig {
  /** Unique identifier for this extractor */
  id: string
  /** Human-readable description of what API/pattern this handles */
  description: string
  /** Example APIs that use this pattern */
  examples?: string[]
  /** The extraction function */
  extract: ErrorExtractor
  /**
   * Optional replacement for the raw error body.
   *
   * The executor attaches `errorInfo.data` to the thrown error and surfaces it on
   * the failed tool's `output.data`, so an extractor that exists because a provider
   * echoes a credential back must redact the body too — scrubbing only the message
   * leaves the original reachable at `output.data`.
   */
  redactData?: (errorInfo?: ErrorInfo) => unknown
}

const PITCHBOOK_UNAUTHORIZED_MESSAGE =
  'PitchBook rejected the API key. Check that the key is active and has API access.'

/**
 * PitchBook's unauthorized body echoes the submitted key back inside `message`,
 * so both the message and the retained body have to be replaced.
 */
function isPitchbookUnauthorized(errorInfo?: ErrorInfo): boolean {
  const data = errorInfo?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  return errorInfo?.status === 401 || reason === 'UNAUTHORIZED'
}

const ERROR_EXTRACTORS: ErrorExtractorConfig[] = [
  {
    id: 'atlassian-errors',
    description:
      'Atlassian REST API error formats (errorMessage, errorMessages, errors[].title, message)',
    examples: ['Jira', 'Jira Service Management', 'Confluence', 'JSM Forms/ProForma'],
    extract: (errorInfo) => {
      // JSM Service Desk: singular errorMessage string
      if (errorInfo?.data?.errorMessage) {
        return errorInfo.data.errorMessage
      }
      // Jira Platform: errorMessages array
      if (
        Array.isArray(errorInfo?.data?.errorMessages) &&
        errorInfo.data.errorMessages.length > 0
      ) {
        return errorInfo.data.errorMessages.join(', ')
      }
      // Confluence v2 / Forms API: RFC 7807 errors array with title/detail
      if (Array.isArray(errorInfo?.data?.errors) && errorInfo.data.errors.length > 0) {
        const err = errorInfo.data.errors[0]
        if (err?.title) {
          return err.detail ? `${err.title}: ${err.detail}` : err.title
        }
      }
      // Jira Platform field-level errors object
      if (errorInfo?.data?.errors && !Array.isArray(errorInfo.data.errors)) {
        const fieldErrors = Object.entries(errorInfo.data.errors)
          .map(([field, msg]) => `${field}: ${msg}`)
          .join(', ')
        if (fieldErrors) return fieldErrors
      }
      // Generic message fallback (auth/gateway errors)
      if (errorInfo?.data?.message) {
        return errorInfo.data.message
      }
      return undefined
    },
  },
  {
    id: 'graphql-errors',
    description: 'GraphQL errors array with message field',
    examples: ['Linear API', 'GitHub GraphQL'],
    extract: (errorInfo) => errorInfo?.data?.errors?.[0]?.message,
  },
  {
    id: 'twitter-errors',
    description: 'X/Twitter API error detail field',
    examples: ['Twitter/X API'],
    extract: (errorInfo) => errorInfo?.data?.errors?.[0]?.detail,
  },
  {
    id: 'details-array',
    description: 'Generic details array with message',
    examples: ['Various REST APIs'],
    extract: (errorInfo) => errorInfo?.data?.details?.[0]?.message,
  },
  {
    id: 'details-string-array',
    description: 'Details array containing strings (validation errors)',
    examples: ['Table API', 'Validation APIs'],
    extract: (errorInfo) => {
      const details = errorInfo?.data?.details
      if (!Array.isArray(details) || details.length === 0) return undefined

      // Check if it's an array of strings
      if (details.every((d) => typeof d === 'string')) {
        const errorMessage = errorInfo?.data?.error || 'Validation failed'
        return `${errorMessage}: ${details.join('; ')}`
      }

      return undefined
    },
  },
  {
    id: 'batch-validation-errors',
    description: 'Batch validation errors with row numbers and error arrays',
    examples: ['Table Batch Insert'],
    extract: (errorInfo) => {
      const details = errorInfo?.data?.details
      if (!Array.isArray(details) || details.length === 0) return undefined

      // Check if it's an array of objects with row numbers and errors
      if (
        details.every(
          (d) =>
            typeof d === 'object' &&
            d !== null &&
            'row' in d &&
            'errors' in d &&
            Array.isArray(d.errors)
        )
      ) {
        const errorMessage = errorInfo?.data?.error || 'Validation failed'
        const rowErrors = details
          .map((detail: { row: number; errors: string[] }) => {
            return `Row ${detail.row}: ${detail.errors.join(', ')}`
          })
          .join('; ')
        return `${errorMessage}: ${rowErrors}`
      }

      return undefined
    },
  },
  {
    id: 'nestjs-validation-errors',
    description: 'NestJS validation errors with a message array of field/message objects',
    examples: ['Quartr API'],
    extract: (errorInfo) => {
      const message = errorInfo?.data?.message
      if (!Array.isArray(message) || message.length === 0) return undefined

      const entries = message
        .map((entry) => {
          if (typeof entry === 'string') return entry
          if (entry && typeof entry === 'object' && typeof entry.message === 'string') {
            return typeof entry.field === 'string' && entry.field
              ? `${entry.field}: ${entry.message}`
              : entry.message
          }
          return undefined
        })
        .filter((entry): entry is string => Boolean(entry))
      if (entries.length === 0) return undefined

      const prefix = typeof errorInfo?.data?.error === 'string' ? `${errorInfo.data.error}: ` : ''
      return `${prefix}${entries.join('; ')}`
    },
  },
  {
    id: 'hunter-errors',
    description: 'Hunter API error details',
    examples: ['Hunter.io API'],
    extract: (errorInfo) => errorInfo?.data?.errors?.[0]?.details,
  },
  {
    id: 'square-errors',
    description: 'Square API error format with errors[].detail and errors[].code',
    examples: ['Square API'],
    extract: (errorInfo) => {
      const err = errorInfo?.data?.errors?.[0]
      if (!err) return undefined
      if (err.detail) return err.code ? `${err.detail} (${err.code})` : err.detail
      return err.code
    },
  },
  {
    id: 'errors-array-string',
    description: 'Errors array containing strings or objects with messages',
    examples: ['Various APIs with error arrays'],
    extract: (errorInfo) => {
      if (!Array.isArray(errorInfo?.data?.errors)) return undefined
      const firstError = errorInfo.data.errors[0]
      if (typeof firstError === 'string') return firstError
      return firstError?.message
    },
  },
  {
    id: 'telegram-description',
    description: 'Telegram Bot API description field',
    examples: ['Telegram Bot API'],
    extract: (errorInfo) => errorInfo?.data?.description,
  },
  {
    id: 'standard-message',
    description: 'Standard message field in error response',
    examples: ['Notion', 'Discord', 'GitHub', 'Twilio', 'Slack'],
    extract: (errorInfo) => errorInfo?.data?.message,
  },
  {
    id: 'harmonic-errors',
    description:
      'Harmonic API message errors, string and object FastAPI detail aborts including the enrichment URN, bulk email-enrichment error codes with their quota counters, and validation detail arrays without echoed request input',
    examples: ['Harmonic'],
    extract: (errorInfo) => {
      const data = errorInfo?.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined

      const message = typeof data.message === 'string' ? data.message.trim() : ''
      if (message) return message

      /**
       * Harmonic's Kong edge answers with `message`, but the FastAPI application
       * behind it renders every non-422 abort as a bare string `detail`. Without
       * this branch those become `Request failed with status 403`, because a tool
       * that names an extractor gets no fallback chain.
       */
      if (typeof data.detail === 'string') {
        const detail = data.detail.trim()
        return detail || undefined
      }

      /**
       * `POST /persons` answers 404 with an object detail carrying the enrichment
       * Harmonic just scheduled. The URN is the only handle on that job, so it is
       * appended to the message rather than dropped with the rest of the envelope.
       */
      if (data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)) {
        const detail = data.detail as {
          message?: unknown
          enrichment_urn?: unknown
        }
        const detailMessage = typeof detail.message === 'string' ? detail.message.trim() : ''
        const enrichmentUrn =
          typeof detail.enrichment_urn === 'string' ? detail.enrichment_urn.trim() : ''
        if (!detailMessage) return enrichmentUrn || undefined
        return enrichmentUrn ? `${detailMessage} (${enrichmentUrn})` : detailMessage
      }

      /**
       * The bulk email-enrichment endpoint answers 422/429 with a code in `error`
       * and no message anywhere — `{error: 'MONTHLY_QUOTA_INSUFFICIENT', needed,
       * available, submitted}`. These are the most actionable failures on that path.
       *
       * Gated on one of the documented numeric counters being present. `error` alone
       * is far too common a key to claim: `extractErrorMessage` without an explicit
       * id walks every extractor in order, so a bare `error` check here would swallow
       * OAuth's `{error, error_description}` and return the code instead of the text.
       */
      const emailJobCounters = (['needed', 'available', 'submitted'] as const).filter(
        (key) => typeof data[key] === 'number'
      )
      if (typeof data.error === 'string' && data.error.trim() && emailJobCounters.length > 0) {
        const code = data.error.trim()
        return `${code} (${emailJobCounters.map((key) => `${key} ${data[key]}`).join(', ')})`
      }

      if (!Array.isArray(data.detail)) return undefined
      const details = data.detail
        .map((entry: unknown) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
          const validation = entry as { loc?: unknown; msg?: unknown }
          const detail = typeof validation.msg === 'string' ? validation.msg.trim() : ''
          if (!detail) return ''

          const location = Array.isArray(validation.loc)
            ? validation.loc
                .filter(
                  (segment): segment is string | number =>
                    typeof segment === 'string' || typeof segment === 'number'
                )
                .map(String)
            : []
          const fieldPath = location[0] === 'body' ? location.slice(1) : location
          return fieldPath.length > 0 ? `${fieldPath.join('.')}: ${detail}` : detail
        })
        .filter(Boolean)

      return details.length > 0 ? details.join('; ') : undefined
    },
  },
  {
    id: 'soap-fault',
    description: 'SOAP/XML fault string patterns',
    examples: ['SOAP APIs', 'Legacy XML services'],
    extract: (errorInfo) => errorInfo?.data?.fault?.faultstring || errorInfo?.data?.faultstring,
  },
  {
    id: 'oauth-error-description',
    description: 'OAuth2 error_description field',
    examples: ['Microsoft OAuth', 'Google OAuth', 'OAuth2 providers'],
    extract: (errorInfo) => errorInfo?.data?.error_description,
  },
  {
    id: 'microsoft-graph-errors',
    description:
      'Microsoft Graph error format with nested innerError chain and details[] (Excel, OneDrive, SharePoint, Outlook). See https://learn.microsoft.com/en-us/graph/errors',
    examples: ['Microsoft Excel', 'Microsoft OneDrive', 'Microsoft SharePoint'],
    extract: (errorInfo) => parseGraphErrorFromData(errorInfo?.data),
  },
  {
    id: 'nested-error-object',
    description: 'Error field containing nested object or string',
    examples: ['Airtable', 'Google APIs'],
    extract: (errorInfo) => {
      const error = errorInfo?.data?.error
      if (!error) return undefined
      if (typeof error === 'string') return error
      if (typeof error === 'object') {
        return error.message || JSON.stringify(error)
      }
      return undefined
    },
  },
  {
    id: 'bitbucket-errors',
    description:
      'Bitbucket error envelope: {type:"error", error:{message, detail}}. `message` is the class of failure and `detail` names the offending branch, file, or property, which the bare message does not',
    examples: ['Bitbucket Cloud REST API v2'],
    extract: (errorInfo) => {
      const error = errorInfo?.data?.error
      if (!error || typeof error !== 'object') return undefined
      const message = typeof error.message === 'string' ? error.message.trim() : ''
      const detail = typeof error.detail === 'string' ? error.detail.trim() : ''
      if (!message) return detail || undefined
      if (!detail || detail === message) return message
      return `${message}: ${detail}`
    },
  },
  {
    id: 'dynatrace-errors',
    description:
      'Dynatrace ErrorEnvelope: {error: {code, message, constraintViolations[]}}. The violations name the offending selector or parameter, which the bare message does not',
    examples: ['Dynatrace Environment API v2'],
    extract: (errorInfo) => {
      const error = errorInfo?.data?.error
      if (!error || typeof error !== 'object') return undefined

      const message = typeof error.message === 'string' ? error.message.trim() : ''
      const violations = Array.isArray(error.constraintViolations)
        ? error.constraintViolations
            .map((violation: { path?: unknown; message?: unknown }) => {
              const detail = typeof violation?.message === 'string' ? violation.message.trim() : ''
              if (!detail) return ''
              const path = typeof violation?.path === 'string' ? violation.path.trim() : ''
              return path ? `${path}: ${detail}` : detail
            })
            .filter(Boolean)
        : []

      if (!message && violations.length === 0) return undefined
      if (violations.length === 0) return message
      return message ? `${message} (${violations.join('; ')})` : violations.join('; ')
    },
  },
  {
    id: 'smartlead-errors',
    description:
      'Smartlead error formats: {error} for domain errors, {message} for auth failures, and Joi validation payloads where {error} is only "Bad Request" and {message} carries the detail',
    examples: ['Smartlead API'],
    extract: (errorInfo) => {
      const data = errorInfo?.data
      if (!data || typeof data !== 'object') return undefined

      const message = typeof data.message === 'string' ? data.message.trim() : ''
      const error = typeof data.error === 'string' ? data.error.trim() : ''

      // Joi validation: `error` is the generic "Bad Request", `message` names the field.
      if (message && data.validation) return message
      if (error) return error
      return message || undefined
    },
  },
  {
    id: 'posthog-errors',
    description: 'PostHog API error format with type/code/detail/attr fields',
    examples: ['PostHog API'],
    extract: (errorInfo) => {
      const detail = errorInfo?.data?.detail
      if (typeof detail !== 'string' || !detail.trim()) return undefined
      const attr = errorInfo?.data?.attr
      return typeof attr === 'string' && attr ? `${detail} (${attr})` : detail
    },
  },
  {
    id: 'quickbooks-fault',
    description: 'QuickBooks Online Fault.Error[] responses with authentication and rate guidance',
    examples: ['QuickBooks Online Accounting API'],
    extract: (errorInfo) => {
      const status = errorInfo?.status
      const data = errorInfo?.data
      const fault =
        sanitizeQuickBooksFaultData(data) ??
        (data && typeof data === 'object' && !Array.isArray(data)
          ? sanitizeQuickBooksFaultData((data as Record<string, unknown>).QueryResponse)
          : null)
      if (!fault) return null

      const guidance =
        status === 401
          ? 'Reconnect the QuickBooks credential.'
          : status === 403
            ? 'Confirm the QuickBooks accounting scope and access to this company.'
            : status === 429
              ? 'QuickBooks rate limit reached; retry after the indicated delay.'
              : ''
      const statusMessage =
        typeof status === 'number'
          ? `QuickBooks request failed with HTTP ${status}.`
          : 'QuickBooks request failed.'
      return [statusMessage, guidance, formatQuickBooksFaultDetail(fault)].filter(Boolean).join(' ')
    },
  },
  {
    id: 'prospeo-errors',
    description: 'Prospeo API error_code with optional filter_error and message details',
    examples: ['Prospeo API'],
    extract: (errorInfo) => {
      const data = errorInfo?.data
      if (!data || typeof data !== 'object') return undefined

      const parts = [data.error_code, data.filter_error, data.message].filter(
        (part): part is string => typeof part === 'string' && Boolean(part.trim())
      )
      return parts.length > 0 ? parts.join(': ') : undefined
    },
  },
  {
    id: 'crunchbase-errors',
    description:
      'Crunchbase Data API error envelope: a top-level JSON array of {status, code, message}. Nothing else in this registry reads a bare array, so without it a rejected key or malformed predicate reports only its HTTP status',
    examples: ['Crunchbase'],
    extract: (errorInfo) => {
      const entries = Array.isArray(errorInfo?.data) ? errorInfo.data : undefined
      if (!entries?.length) return undefined

      const messages = entries
        .map((entry: { message?: unknown }) =>
          typeof entry?.message === 'string' ? entry.message.trim() : ''
        )
        .filter(Boolean)

      return messages.length > 0 ? messages.join('; ') : undefined
    },
  },
  {
    id: 'pitchbook-errors',
    description:
      'PitchBook Public API error envelope: {reason, message}. An unauthorized response echoes the rejected key back inside `message` ("Active API key {KEY} not found"), so that case is replaced with a fixed string — the generic message fallback would otherwise put the credential in the block error, the run log, and any agent context reading the failure. Returns undefined unless the body carries a `message`, so that on the generic fallback chain — which every tool without an `errorExtractor` walks — a foreign 401 is never labelled a PitchBook auth failure',
    examples: ['PitchBook'],
    extract: (errorInfo) => {
      const data = errorInfo?.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined

      const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
      const message = typeof data.message === 'string' ? data.message.trim() : ''
      if (!message) return undefined

      if (isPitchbookUnauthorized(errorInfo)) return PITCHBOOK_UNAUTHORIZED_MESSAGE

      return reason ? `${message} (${reason})` : message
    },
    redactData: (errorInfo) => {
      if (!isPitchbookUnauthorized(errorInfo)) return errorInfo?.data
      const reason = (errorInfo?.data as { reason?: unknown } | undefined)?.reason
      return { reason, message: PITCHBOOK_UNAUTHORIZED_MESSAGE }
    },
  },
  {
    id: 'splunk-errors',
    description:
      'Splunk REST message envelope: {messages: [{type, text}]}. Under the output_mode=json every Splunk request pins, this is where a rejected SPL string explains itself — without it the failure reports only the HTTP status text',
    examples: ['Splunk Enterprise', 'Splunk Cloud'],
    extract: (errorInfo) => {
      const messages = errorInfo?.data?.messages
      if (!Array.isArray(messages) || messages.length === 0) return undefined

      const texts = messages
        .map((message: { type?: unknown; text?: unknown }) => ({
          type: typeof message?.type === 'string' ? message.type.toUpperCase() : '',
          text: typeof message?.text === 'string' ? message.text.trim() : '',
        }))
        .filter((message) => message.text)

      if (texts.length === 0) return undefined

      // A failing request carries the cause on the ERROR/FATAL entries; the rest
      // are the INFO/WARN/DEBUG chatter Splunk attaches to every response.
      const fatal = texts.filter((message) => message.type === 'ERROR' || message.type === 'FATAL')
      const selected = fatal.length > 0 ? fatal : texts
      return selected.map((message) => message.text).join('; ')
    },
  },
  {
    id: 'plain-text-data',
    description: 'Plain text error response',
    examples: ['APIs returning plain text errors like Apollo'],
    extract: (errorInfo) => {
      // If data is a plain string (not an object), use it directly
      if (typeof errorInfo?.data === 'string' && errorInfo.data.trim()) {
        return errorInfo.data.trim()
      }
      return undefined
    },
  },
  {
    id: 'http-status-text',
    description: 'HTTP response status text fallback',
    examples: ['Generic HTTP errors'],
    extract: (errorInfo) => errorInfo?.statusText,
  },
]

const EXTRACTOR_MAP = new Map<string, ErrorExtractorConfig>(ERROR_EXTRACTORS.map((e) => [e.id, e]))

export function extractErrorMessageWithId(
  errorInfo: ErrorInfo | undefined,
  extractorId: string
): string {
  const extractor = EXTRACTOR_MAP.get(extractorId)

  if (!extractor) {
    return `Request failed with status ${errorInfo?.status || 'unknown'}`
  }

  try {
    const message = extractor.extract(errorInfo)
    if (message?.trim()) {
      return message
    }
  } catch {}

  return `Request failed with status ${errorInfo?.status || 'unknown'}`
}

/**
 * Body to retain on a failed tool result, with any credential the provider echoed
 * back replaced. Falls back to the original body when no extractor redacts it.
 */
export function redactErrorData(errorInfo?: ErrorInfo, extractorId?: string): unknown {
  if (!extractorId) return errorInfo?.data
  const extractor = ERROR_EXTRACTORS.find((candidate) => candidate.id === extractorId)
  if (!extractor?.redactData) return errorInfo?.data
  try {
    return extractor.redactData(errorInfo)
  } catch {
    return errorInfo?.data
  }
}

export function extractErrorMessage(errorInfo?: ErrorInfo, extractorId?: string): string {
  if (extractorId) {
    return extractErrorMessageWithId(errorInfo, extractorId)
  }

  // Backwards compatibility
  for (const extractor of ERROR_EXTRACTORS) {
    try {
      const message = extractor.extract(errorInfo)
      if (message?.trim()) {
        return message
      }
    } catch {}
  }

  return `Request failed with status ${errorInfo?.status || 'unknown'}`
}

export const ErrorExtractorId = {
  ATLASSIAN_ERRORS: 'atlassian-errors',
  MICROSOFT_GRAPH_ERRORS: 'microsoft-graph-errors',
  GRAPHQL_ERRORS: 'graphql-errors',
  TWITTER_ERRORS: 'twitter-errors',
  DETAILS_ARRAY: 'details-array',
  DETAILS_STRING_ARRAY: 'details-string-array',
  BATCH_VALIDATION_ERRORS: 'batch-validation-errors',
  NESTJS_VALIDATION_ERRORS: 'nestjs-validation-errors',
  HUNTER_ERRORS: 'hunter-errors',
  SQUARE_ERRORS: 'square-errors',
  ERRORS_ARRAY_STRING: 'errors-array-string',
  TELEGRAM_DESCRIPTION: 'telegram-description',
  STANDARD_MESSAGE: 'standard-message',
  HARMONIC_ERRORS: 'harmonic-errors',
  SOAP_FAULT: 'soap-fault',
  OAUTH_ERROR_DESCRIPTION: 'oauth-error-description',
  NESTED_ERROR_OBJECT: 'nested-error-object',
  BITBUCKET_ERRORS: 'bitbucket-errors',
  DYNATRACE_ERRORS: 'dynatrace-errors',
  SMARTLEAD_ERRORS: 'smartlead-errors',
  POSTHOG_ERRORS: 'posthog-errors',
  QUICKBOOKS_FAULT: 'quickbooks-fault',
  PROSPEO_ERRORS: 'prospeo-errors',
  CRUNCHBASE_ERRORS: 'crunchbase-errors',
  PITCHBOOK_ERRORS: 'pitchbook-errors',
  SPLUNK_ERRORS: 'splunk-errors',
  PLAIN_TEXT_DATA: 'plain-text-data',
  HTTP_STATUS_TEXT: 'http-status-text',
} as const
