const SAFE_ERROR_CODES = new Set([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'server_error',
  'unknown_model',
  'BadRequest',
  'InvalidRequest',
  'DeploymentNotFound',
  'ResourceNotFound',
  'OperationNotSupported',
  'Unauthorized',
  'Forbidden',
  'TooManyRequests',
  'InternalServerError',
  'ServiceUnavailable',
])

function safeCode(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && SAFE_ERROR_CODES.has(value)) return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599)
    return String(value)
  return 'unrecognized'
}

function safeRequestId(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null
}

/** Projects bounded OCR error responses without retaining messages, document data or URLs. */
export function getOcrResponseDiagnostic(headers: Pick<Headers, 'get'>, body: string) {
  const diagnostic = {
    providerRequestId:
      safeRequestId(headers.get('x-request-id')) ??
      safeRequestId(headers.get('apim-request-id')) ??
      safeRequestId(headers.get('x-ms-request-id')),
    bodyFormat: body ? 'non_json' : 'unavailable',
    providerErrorCode: null as string | null,
    providerErrorType: null as string | null,
  }
  if (!body) return diagnostic
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return diagnostic
  }
  diagnostic.bodyFormat = 'json'
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return diagnostic
  const error = 'error' in parsed ? parsed.error : parsed
  if (!error || typeof error !== 'object' || Array.isArray(error)) return diagnostic
  diagnostic.providerErrorCode = safeCode('code' in error ? error.code : undefined)
  diagnostic.providerErrorType = safeCode('type' in error ? error.type : undefined)
  return diagnostic
}
