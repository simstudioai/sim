import {
  DEFAULT_MAX_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import type { ValidatedOciDestination } from '@/lib/internal/oci/endpoints'
import { OciRequestError, parseOciErrorBody } from '@/lib/internal/oci/errors'
import {
  type OciRequestMethod,
  type OciSigningCredentials,
  signOciRequest,
} from '@/lib/internal/oci/signing.server'

const MAX_OCI_TIMEOUT_MS = 5 * 60 * 1000

export interface OciRequestResult {
  readonly response: SecureFetchResponse
  readonly opcRequestId?: string
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function serializeOciQueryPairs(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join('&')
}

export function buildOciRequestUrl(
  destination: ValidatedOciDestination,
  encodedPath: string,
  queryPairs: readonly (readonly [string, string])[] = []
): string {
  if (
    !encodedPath.startsWith('/') ||
    encodedPath.startsWith('//') ||
    encodedPath.includes('//') ||
    /[?#\\\u0000-\u001f\u007f]/.test(encodedPath) ||
    /%(?![0-9a-f]{2})/i.test(encodedPath)
  ) {
    throw new Error('OCI request path must be a single encoded absolute path')
  }
  const query = serializeOciQueryPairs(queryPairs)
  return `${destination.origin}${encodedPath}${query ? `?${query}` : ''}`
}

function validateRequestLimits(timeout: number, maxResponseBytes: number): void {
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_OCI_TIMEOUT_MS) {
    throw new Error('OCI timeout is outside the supported range')
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES
  ) {
    throw new Error('OCI response ceiling is outside the supported range')
  }
}

function sensitiveRequestValues(
  credentials: OciSigningCredentials,
  authorization: string | undefined,
  requestUrl: string
): string[] {
  return [
    credentials.tenancyId,
    credentials.userId,
    credentials.fingerprint,
    credentials.fingerprint.toUpperCase(),
    credentials.privateKey,
    credentials.passphrase ?? '',
    authorization ?? '',
    requestUrl,
  ].filter(Boolean)
}

/** Sends one bounded, redirect-free OCI request to an already validated destination. */
export async function sendOciRequest(params: {
  destination: ValidatedOciDestination
  credentials: OciSigningCredentials
  method: OciRequestMethod
  encodedPath: string
  queryPairs?: readonly (readonly [string, string])[]
  timeout: number
  maxResponseBytes: number
  signal?: AbortSignal
  serviceHeaders?: Readonly<Record<string, string>>
  body?: string
  contentType?: string
}): Promise<OciRequestResult> {
  validateRequestLimits(params.timeout, params.maxResponseBytes)
  const url = buildOciRequestUrl(params.destination, params.encodedPath, params.queryPairs)
  const signed = await signOciRequest({
    credentials: params.credentials,
    method: params.method,
    url,
    serviceHeaders: params.serviceHeaders,
    body: params.body,
    contentType: params.contentType,
  })
  const response = await secureFetchWithValidation(
    signed.url,
    {
      method: signed.method,
      headers: { ...signed.headers },
      ...(signed.body !== undefined ? { body: signed.body } : {}),
      timeout: params.timeout,
      maxResponseBytes: params.maxResponseBytes,
      maxRedirects: 0,
      signal: params.signal,
      profile: 'configuredEndpoint',
      logUrlValidationDetails: false,
    },
    'OCI destination'
  )
  const opcRequestId = response.headers.get('opc-request-id') ?? undefined
  if (response.ok) return { response, opcRequestId }

  const sensitiveValues = sensitiveRequestValues(
    params.credentials,
    signed.headers.authorization,
    signed.url
  )
  const body = await response.text()
  const error = parseOciErrorBody(body, sensitiveValues)
  throw new OciRequestError({
    status: response.status,
    code: error.code,
    message: error.message,
    opcRequestId,
    sensitiveValues,
  })
}
