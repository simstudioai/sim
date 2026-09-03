import {
  DEFAULT_MAX_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { ValidatedOciDestination } from '@/lib/internal/oci/endpoints'
import { OciRequestError, parseOciErrorBody } from '@/lib/internal/oci/errors'
import {
  type OciRequestMethod,
  type OciSigningCredentials,
  signOciRequest,
} from '@/lib/internal/oci/signing.server'

const MAX_OCI_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OCI_REDACTABLE_REQUEST_MATERIAL_LENGTH = 65_536

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
  if (new URL(`${destination.origin}${encodedPath}`).pathname !== encodedPath) {
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
  requestUrl: string,
  requestBody: string | undefined,
  serviceHeaderValues: readonly string[]
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
    requestBody ?? '',
    ...serviceHeaderValues,
  ].filter(Boolean)
}

function getSignedServiceHeaderValues(
  serviceHeaders: Readonly<Record<string, string>> | undefined,
  signedHeaders: Readonly<Record<string, string>>
): string[] {
  return Object.keys(serviceHeaders ?? {}).flatMap((name) => {
    const value = signedHeaders[name.toLowerCase()]
    return value === undefined ? [] : [value]
  })
}

function isRedactableRequestMaterial(values: readonly (string | undefined)[]): boolean {
  let totalLength = 0
  for (const value of values) {
    if (value === undefined) continue
    totalLength += value.length
    if (totalLength > MAX_OCI_REDACTABLE_REQUEST_MATERIAL_LENGTH) return false
  }
  return true
}

async function readOciErrorBody(
  response: SecureFetchResponse,
  method: OciRequestMethod,
  maxResponseBytes: number,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  try {
    return await readResponseTextWithLimit(response, {
      maxBytes: Math.min(DEFAULT_MAX_ERROR_BODY_BYTES, maxResponseBytes),
      label: 'OCI error response',
      signal,
      allowNoBodyFallback: true,
      requestMethod: method,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    await response.body?.cancel().catch(() => {})
    return undefined
  }
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

  const serviceHeaderValues = getSignedServiceHeaderValues(params.serviceHeaders, signed.headers)
  const requestMaterialIsRedactable = isRedactableRequestMaterial([
    signed.body,
    ...serviceHeaderValues,
  ])
  if (!requestMaterialIsRedactable) {
    await response.body?.cancel().catch(() => {})
    throw new OciRequestError({ status: response.status })
  }
  const sensitiveValues = sensitiveRequestValues(
    params.credentials,
    signed.headers.authorization,
    signed.url,
    signed.body,
    serviceHeaderValues
  )
  const body = await readOciErrorBody(
    response,
    signed.method,
    params.maxResponseBytes,
    params.signal
  )
  const error = body === undefined ? {} : parseOciErrorBody(body, sensitiveValues)
  throw new OciRequestError({
    status: response.status,
    code: error.code,
    message: error.message,
    opcRequestId,
    sensitiveValues,
  })
}
