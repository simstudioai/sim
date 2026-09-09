import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { OracleEpmErrorPolicyDeclaration } from '@/lib/internal/oracle-epm/types'

/** Stable public failure categories emitted by the guarded transport. */
export type OracleEpmErrorCategory =
  | 'authentication_required'
  | 'conflict'
  | 'forbidden'
  | 'invalid_configuration'
  | 'invalid_input'
  | 'invalid_response'
  | 'not_found'
  | 'payload_too_large'
  | 'rate_limited'
  | 'service_unavailable'
  | 'timeout'

const PUBLIC_MESSAGES: Readonly<Record<OracleEpmErrorCategory, string>> = Object.freeze({
  authentication_required: 'Oracle EPM authentication failed',
  conflict: 'Oracle EPM rejected the request because of a conflict',
  forbidden: 'Oracle EPM denied the request',
  invalid_configuration: 'Oracle EPM is not configured correctly',
  invalid_input: 'Oracle EPM rejected the request input',
  invalid_response: 'Oracle EPM returned an invalid response',
  not_found: 'The requested Oracle EPM resource was not found',
  payload_too_large: 'The Oracle EPM payload exceeded the allowed size',
  rate_limited: 'Oracle EPM rate limited the request',
  service_unavailable: 'Oracle EPM is temporarily unavailable',
  timeout: 'The Oracle EPM request timed out',
})

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const ERROR_CONSTRUCTION_TOKEN = Symbol('oracle-epm-error')

/** Public transport error whose fields are intentionally finite and non-provider-authored. */
export class OracleEpmError extends Error {
  readonly category: OracleEpmErrorCategory
  readonly status?: number
  readonly providerCode?: string
  readonly retryable: boolean
  readonly correlationId?: string

  constructor(
    input: {
      category: OracleEpmErrorCategory
      status?: number
      providerCode?: string
      retryable: boolean
      correlationId?: string
    },
    token: symbol
  ) {
    if (token !== ERROR_CONSTRUCTION_TOKEN) {
      throw new Error('Oracle EPM errors can only be created by the guarded transport')
    }
    super(PUBLIC_MESSAGES[input.category])
    this.name = 'OracleEpmError'
    this.category = input.category
    this.status = input.status
    this.providerCode = input.providerCode
    this.retryable = input.retryable
    this.correlationId = input.correlationId
    Object.freeze(this)
  }
}

/** Admits only bounded, printable request identifiers. */
export function validateOracleEpmCorrelationId(value: string | null): string | undefined {
  return value && CORRELATION_ID.test(value) ? value : undefined
}

/** Maps a provider HTTP failure into the finite public category set. */
export function categoryForOracleEpmStatus(status: number): OracleEpmErrorCategory {
  if (status === 400 || status === 422) return 'invalid_input'
  if (status === 401) return 'authentication_required'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409 || status === 412) return 'conflict'
  if (status === 413) return 'payload_too_large'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  return 'service_unavailable'
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const part of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Builds a safe error from a failed response. Provider text is read only to
 * select an explicitly allowlisted code and is never retained or reflected.
 */
export async function oracleEpmErrorFromResponse(
  response: SecureFetchResponse,
  policy: OracleEpmErrorPolicyDeclaration | undefined,
  retryable: boolean
): Promise<OracleEpmError> {
  let providerCode: string | undefined
  if (policy?.providerCodePath?.length && policy.allowedProviderCodes?.length) {
    try {
      const body = await readResponseJsonWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Oracle EPM error response',
      })
      const candidate = readPath(body, policy.providerCodePath)
      if (typeof candidate === 'string' && policy.allowedProviderCodes.includes(candidate)) {
        providerCode = candidate
      }
    } catch {
      // Provider bodies are deliberately discarded, including parse failures.
    }
  } else {
    await response.body?.cancel().catch(() => undefined)
  }
  const correlationId = policy?.correlationHeaders
    ?.map((name) => validateOracleEpmCorrelationId(response.headers.get(name)))
    .find((value): value is string => value !== undefined)
  const hasPublicHttpStatus =
    Number.isInteger(response.status) && response.status >= 400 && response.status <= 599
  return new OracleEpmError(
    {
      category: hasPublicHttpStatus
        ? categoryForOracleEpmStatus(response.status)
        : 'invalid_response',
      status: hasPublicHttpStatus ? response.status : undefined,
      providerCode,
      retryable,
      correlationId,
    },
    ERROR_CONSTRUCTION_TOKEN
  )
}

/** Creates a fixed-message failure for a local transport guard. */
export function oracleEpmLocalError(
  category: OracleEpmErrorCategory,
  retryable = false
): OracleEpmError {
  return new OracleEpmError({ category, retryable }, ERROR_CONSTRUCTION_TOKEN)
}
