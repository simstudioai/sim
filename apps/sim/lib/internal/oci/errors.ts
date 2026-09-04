export type OciClientErrorCode =
  | 'credential_unavailable'
  | 'invalid_request'
  | 'invalid_endpoint'
  | 'deadline_exceeded'
  | 'aborted'
  | 'response_too_large'
  | 'request_failed'

const ERROR_MESSAGES: Record<OciClientErrorCode, string> = {
  credential_unavailable: 'OCI credential is unavailable',
  invalid_request: 'OCI request is invalid',
  invalid_endpoint: 'OCI endpoint is invalid',
  deadline_exceeded: 'OCI request deadline exceeded',
  aborted: 'OCI request was canceled',
  response_too_large: 'OCI response exceeded the configured limit',
  request_failed: 'OCI request failed',
}

function safeRequestId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    /[^\x20-\x7e]/.test(value)
  ) {
    return undefined
  }
  return value
}

/** Stable, provider-message-free failure projected by the native OCI client. */
export class OciClientError extends Error {
  readonly code: OciClientErrorCode
  readonly status?: number
  readonly opcRequestId?: string

  constructor(code: OciClientErrorCode, options: { status?: number; opcRequestId?: unknown } = {}) {
    super(ERROR_MESSAGES[code])
    this.name = 'OciClientError'
    this.code = code
    if (
      options.status !== undefined &&
      Number.isInteger(options.status) &&
      options.status >= 100 &&
      options.status <= 599
    ) {
      this.status = options.status
    }
    this.opcRequestId = safeRequestId(options.opcRequestId)
  }
}
