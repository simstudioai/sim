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

export interface ErrorInfo {
  status?: number
  statusText?: string
  data?: any
}

export type ErrorExtractor = (errorInfo?: ErrorInfo) => string | null | undefined

export interface ErrorExtractorConfig {
  /** Unique identifier for this extractor */
  id: string
  /** Human-readable description of what API/pattern this handles */
  description: string
  /** Example APIs that use this pattern */
  examples?: string[]
  /** The extraction function */
  extract: ErrorExtractor
}

const ERROR_EXTRACTORS: ErrorExtractorConfig[] = [
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
    id: 'hunter-errors',
    description: 'Hunter API error details',
    examples: ['Hunter.io API'],
    extract: (errorInfo) => errorInfo?.data?.errors?.[0]?.details,
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
  } catch (error) {}

  return `Request failed with status ${errorInfo?.status || 'unknown'}`
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
    } catch (error) {}
  }

  return `Request failed with status ${errorInfo?.status || 'unknown'}`
}

export const ErrorExtractorId = {
  GRAPHQL_ERRORS: 'graphql-errors',
  TWITTER_ERRORS: 'twitter-errors',
  DETAILS_ARRAY: 'details-array',
  HUNTER_ERRORS: 'hunter-errors',
  ERRORS_ARRAY_STRING: 'errors-array-string',
  TELEGRAM_DESCRIPTION: 'telegram-description',
  STANDARD_MESSAGE: 'standard-message',
  SOAP_FAULT: 'soap-fault',
  OAUTH_ERROR_DESCRIPTION: 'oauth-error-description',
  NESTED_ERROR_OBJECT: 'nested-error-object',
  HTTP_STATUS_TEXT: 'http-status-text',
} as const
