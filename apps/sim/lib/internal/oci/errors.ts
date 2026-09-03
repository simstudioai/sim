const MAX_OCI_ERROR_FIELD_LENGTH = 1024

function sanitizeOciErrorField(
  value: unknown,
  sensitiveValues: readonly string[] = []
): string | undefined {
  if (typeof value !== 'string') return undefined
  let sanitized = value
    .replace(/-----BEGIN[\s\S]*/gi, '[redacted-key]')
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/Signature\s+version="1",[^\r\n]*/gi, '[redacted-authorization]')
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length > 0) sanitized = sanitized.split(sensitiveValue).join('[redacted]')
  }
  sanitized = sanitized.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return sanitized ? sanitized.slice(0, MAX_OCI_ERROR_FIELD_LENGTH) : undefined
}

/** A bounded, credential-safe projection of an OCI service error. */
export class OciRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly opcRequestId?: string

  constructor(params: {
    status: number
    code?: unknown
    message?: unknown
    opcRequestId?: unknown
    sensitiveValues?: readonly string[]
  }) {
    const code = sanitizeOciErrorField(params.code, params.sensitiveValues)
    const message = sanitizeOciErrorField(params.message, params.sensitiveValues)
    super(
      message ? `OCI request failed: ${message}` : `OCI request failed with status ${params.status}`
    )
    this.name = 'OciRequestError'
    this.status = params.status
    this.code = code
    this.opcRequestId = sanitizeOciErrorField(params.opcRequestId, params.sensitiveValues)
  }
}

export function parseOciErrorBody(
  body: string,
  sensitiveValues: readonly string[] = []
): { code?: string; message?: string } {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      code: sanitizeOciErrorField(record.code, sensitiveValues),
      message: sanitizeOciErrorField(record.message, sensitiveValues),
    }
  } catch {
    return {}
  }
}
