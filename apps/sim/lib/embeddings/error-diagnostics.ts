/** Only recognized machine codes may leave a provider's untrusted response body. */
const SAFE_ERROR_CODES = new Set([
  'model_not_found',
  'invalid_api_key',
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'rate_limit_exceeded',
  'insufficient_quota',
  'context_length_exceeded',
  'server_error',
  'DeploymentNotFound',
  'ResourceNotFound',
  'OperationNotSupported',
  'InvalidRequest',
  'Unauthorized',
  'Forbidden',
  'TooManyRequests',
  'InternalServerError',
  'ServiceUnavailable',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'RESOURCE_EXHAUSTED',
  'INTERNAL',
  'UNAVAILABLE',
])

function safeErrorCode(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && SAFE_ERROR_CODES.has(value)) return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) {
    return String(value)
  }
  return 'unrecognized'
}

function safeRequestId(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null
}

interface EmbeddingResponseDiagnostic {
  providerRequestId: string | null
  bodyFormat: 'json' | 'non_json' | 'unavailable'
  providerErrorCode: string | null
  providerErrorType: string | null
}

/**
 * Internal log metadata only. Never retain free-form messages, request inputs,
 * response bodies, or the full header bag on errors that can reach callers.
 */
export function getEmbeddingResponseDiagnostic(
  headers: Headers,
  body: string
): EmbeddingResponseDiagnostic {
  const diagnostic: EmbeddingResponseDiagnostic = {
    providerRequestId:
      safeRequestId(headers.get('x-request-id')) ??
      safeRequestId(headers.get('apim-request-id')) ??
      safeRequestId(headers.get('x-ms-request-id')),
    bodyFormat: body ? 'non_json' : 'unavailable',
    providerErrorCode: null,
    providerErrorType: null,
  }
  if (!body) return diagnostic
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return diagnostic
  }
  diagnostic.bodyFormat = 'json'
  if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) return diagnostic
  const error = parsed.error
  if (!error || typeof error !== 'object') return diagnostic
  diagnostic.providerErrorCode = safeErrorCode('code' in error ? error.code : undefined)
  diagnostic.providerErrorType = safeErrorCode(
    'type' in error ? error.type : 'status' in error ? error.status : undefined
  )
  return diagnostic
}
