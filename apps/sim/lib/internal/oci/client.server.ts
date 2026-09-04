import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  type KeyObject,
} from 'node:crypto'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { and, eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  type SecureFetchOptions,
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  createOciStaticEndpointPolicy,
  type OciDiscoveredEndpointPolicy,
  type OciEndpointPolicy,
  type OciPreparedEndpoint,
  type OciRegion,
  type OciStaticEndpointPolicy,
  resolveDiscoveredOciEndpoint,
  resolveEffectiveOciRegion,
  resolveStaticOciEndpoint,
} from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type OAuthService,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
  OCI_SERVICE_ID,
} from '@/lib/oauth/types'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'

export type OciRequestMethod = 'GET' | 'HEAD' | 'DELETE' | 'POST' | 'PUT' | 'PATCH'

export interface OciSafeRetryPolicy {
  readonly kind: 'safe'
  readonly maxAttempts: number
}

export interface OciTokenizedRetryPolicy {
  readonly kind: 'tokenized'
  readonly maxAttempts: number
  readonly retryToken: string
}

export type OciRetryPolicy = OciSafeRetryPolicy | OciTokenizedRetryPolicy

interface OciRequestBase {
  readonly endpoint: OciPreparedEndpoint
  readonly encodedPath: string
  readonly queryPairs?: readonly (readonly [string, string])[]
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly responseHeaders?: readonly string[]
  readonly signal?: AbortSignal
}

export type OciRequest =
  | (OciRequestBase & {
      readonly method: 'GET' | 'HEAD'
      readonly body?: never
      readonly contentType?: never
      readonly retry?: OciRetryPolicy
    })
  | (OciRequestBase & {
      readonly method: 'DELETE'
      readonly body?: never
      readonly contentType?: never
      readonly retry?: OciTokenizedRetryPolicy
    })
  | (OciRequestBase & {
      readonly method: 'POST' | 'PUT' | 'PATCH'
      readonly body: Uint8Array
      readonly contentType: string
      readonly retry?: OciTokenizedRetryPolicy
    })

declare const authenticatedOciResponseBrand: unique symbol

export interface OciAuthenticatedResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly opcRequestId?: string
  readonly body: Uint8Array
  readonly [authenticatedOciResponseBrand]: true
}

export interface OciClient {
  prepareStaticEndpoint(policy: OciStaticEndpointPolicy): Promise<OciPreparedEndpoint>
  prepareDiscoveredEndpoint(
    policy: OciDiscoveredEndpointPolicy,
    response: OciAuthenticatedResponse
  ): Promise<OciPreparedEndpoint>
  request(request: OciRequest): Promise<OciAuthenticatedResponse>
}

/**
 * Trusted binding supplied by a server-side operation after normal credential
 * authorization. `credentialId` must be `authz.resolvedCredentialId` (or the
 * selector equivalent), and `workspaceId` must come from the operation's
 * trusted execution context. A caller-controlled database ID is not authority.
 */
export interface CreateOciClientParams {
  readonly credentialId: string
  readonly workspaceId: string
  readonly serviceId: OAuthService
  readonly region?: string
}

interface OciCredentialMaterial {
  readonly tenancyOcid: string
  readonly userOcid: string
  readonly fingerprint: string
  readonly privateKey: KeyObject
  readonly region: string
}

interface BoundResponseSnapshot {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
  readonly region: OciRegion
  readonly policy: OciEndpointPolicy
}

interface SignedOciRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: Uint8Array
}

const BODY_METHODS: ReadonlySet<OciRequestMethod> = new Set(['POST', 'PUT', 'PATCH'])
const SAFE_RETRY_METHODS: ReadonlySet<OciRequestMethod> = new Set(['GET', 'HEAD'])
const REQUEST_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'DELETE',
  'POST',
  'PUT',
  'PATCH',
])
const SIGNING_CONTROLLED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'host',
  'date',
  'x-date',
  'content-length',
  'content-type',
  'x-content-sha256',
])
const RESPONSE_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  'content-type',
  'etag',
  'location',
  'opc-next-page',
  'opc-request-id',
  'opc-work-request-id',
  'retry-after',
])
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504])
const RETRYABLE_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
])
const MAX_OCID_LENGTH = 255
const MAX_PRIVATE_KEY_BYTES = 64 * 1024
const MAX_PASSPHRASE_BYTES = 4 * 1024
const MAX_TIMEOUT_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_RETRY_TOKEN_BYTES = 512
const SETUP_VERIFICATION_TIMEOUT_MS = 10_000
const SETUP_VERIFICATION_RESPONSE_BYTES = 64 * 1024
const OCID_PATTERN = /^ocid1\.([a-z][a-z0-9_-]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9_-]+)$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/
const PEM_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function credentialUnavailable(): OciClientError {
  return new OciClientError('credential_unavailable')
}

function assertExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const keys = Object.keys(record)
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw credentialUnavailable()
  }
}

function parseOcid(value: unknown, type: 'tenancy' | 'user'): { value: string; realm: string } {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_OCID_LENGTH ||
    CONTROL_PATTERN.test(value)
  ) {
    throw credentialUnavailable()
  }
  const match = OCID_PATTERN.exec(value)
  if (!match || match[1] !== type) throw credentialUnavailable()
  return { value, realm: match[2] }
}

function normalizeFingerprint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || CONTROL_PATTERN.test(value)) {
    throw credentialUnavailable()
  }
  const hex = value.replace(/[:\s]/g, '').toLowerCase()
  const bytes = /^[0-9a-f]{32}$/.test(hex) ? hex.match(/.{2}/g) : null
  if (!bytes) throw credentialUnavailable()
  return bytes.join(':')
}

function parseCredentialMaterial(serialized: string): OciCredentialMaterial {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw credentialUnavailable()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw credentialUnavailable()
  }
  const record = parsed as Record<string, unknown>
  assertExactKeys(
    record,
    [
      'type',
      'providerId',
      'tenancyOcid',
      'userOcid',
      'fingerprint',
      'privateKey',
      'region',
      'metadata',
    ],
    ['privateKeyPassphrase']
  )
  if (
    record.type !== OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE ||
    record.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID ||
    !record.metadata ||
    typeof record.metadata !== 'object' ||
    Array.isArray(record.metadata)
  ) {
    throw credentialUnavailable()
  }
  const metadata = record.metadata as Record<string, unknown>
  assertExactKeys(metadata, ['principalKind', 'principalId'])
  const tenancy = parseOcid(record.tenancyOcid, 'tenancy')
  const user = parseOcid(record.userOcid, 'user')
  if (tenancy.realm !== user.realm) throw credentialUnavailable()

  const fingerprint = normalizeFingerprint(record.fingerprint)
  if (record.fingerprint !== fingerprint) throw credentialUnavailable()
  if (
    typeof record.privateKey !== 'string' ||
    record.privateKey.length === 0 ||
    Buffer.byteLength(record.privateKey, 'utf8') > MAX_PRIVATE_KEY_BYTES ||
    PEM_CONTROL_PATTERN.test(record.privateKey)
  ) {
    throw credentialUnavailable()
  }
  const normalizedPrivateKey = `${record.privateKey.replace(/\r\n?/g, '\n').trim()}\n`
  if (record.privateKey !== normalizedPrivateKey) throw credentialUnavailable()

  let passphrase: string | undefined
  if (Object.hasOwn(record, 'privateKeyPassphrase')) {
    if (
      typeof record.privateKeyPassphrase !== 'string' ||
      Buffer.byteLength(record.privateKeyPassphrase, 'utf8') > MAX_PASSPHRASE_BYTES ||
      CONTROL_PATTERN.test(record.privateKeyPassphrase)
    ) {
      throw credentialUnavailable()
    }
    passphrase = record.privateKeyPassphrase
  }
  if (
    typeof record.region !== 'string' ||
    record.region !== record.region.trim().toLowerCase() ||
    metadata.principalKind !== 'user' ||
    metadata.principalId !== user.value
  ) {
    throw credentialUnavailable()
  }
  const region = resolveEffectiveOciRegion(record.region)
  if (region.realm.id !== tenancy.realm) throw credentialUnavailable()

  let privateKey: KeyObject
  try {
    privateKey = createPrivateKey({
      key: normalizedPrivateKey,
      format: 'pem',
      ...(passphrase !== undefined ? { passphrase } : {}),
    })
  } catch {
    throw credentialUnavailable()
  }
  if (
    privateKey.asymmetricKeyType !== 'rsa' ||
    privateKey.asymmetricKeyDetails?.modulusLength === undefined ||
    privateKey.asymmetricKeyDetails.modulusLength < 2048
  ) {
    throw credentialUnavailable()
  }
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const derivedFingerprint = createHash('md5').update(publicKey).digest()
  const submittedFingerprint = Buffer.from(fingerprint.replaceAll(':', ''), 'hex')
  if (
    !safeCompare(derivedFingerprint.toString('base64'), submittedFingerprint.toString('base64'))
  ) {
    throw credentialUnavailable()
  }

  return {
    tenancyOcid: tenancy.value,
    userOcid: user.value,
    fingerprint,
    privateKey,
    region: region.id,
  }
}

async function loadCredentialMaterial(params: {
  credentialId: string
  workspaceId: string
}): Promise<OciCredentialMaterial> {
  try {
    const [row] = await db
      .select({ encryptedServiceAccountKey: credential.encryptedServiceAccountKey })
      .from(credential)
      .where(
        and(
          eq(credential.id, params.credentialId),
          eq(credential.workspaceId, params.workspaceId),
          eq(credential.type, 'service_account'),
          eq(credential.providerId, OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID)
        )
      )
      .limit(1)
    if (!row?.encryptedServiceAccountKey) throw credentialUnavailable()
    const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
    return parseCredentialMaterial(decrypted)
  } catch {
    throw credentialUnavailable()
  }
}

function serializeQueryPairs(pairs: readonly (readonly [string, string])[]): string {
  const encode = (value: string) =>
    (() => {
      try {
        return encodeURIComponent(value).replace(
          /[!'()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        )
      } catch {
        throw new OciClientError('invalid_request')
      }
    })()
  return pairs.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&')
}

function buildRequestUrl(
  endpoint: OciPreparedEndpoint,
  encodedPath: string,
  queryPairs: readonly (readonly [string, string])[]
): string {
  if (
    typeof encodedPath !== 'string' ||
    !encodedPath.startsWith('/') ||
    encodedPath.startsWith('//') ||
    encodedPath.includes('//') ||
    /[?#\\\u0000-\u001f\u007f]/.test(encodedPath) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(encodedPath) ||
    /%(?![0-9a-f]{2})/i.test(encodedPath)
  ) {
    throw new OciClientError('invalid_request')
  }
  let url: URL
  try {
    url = new URL(`${endpoint.origin}${encodedPath}`)
  } catch {
    throw new OciClientError('invalid_request')
  }
  if (url.pathname !== encodedPath) throw new OciClientError('invalid_request')
  const query = serializeQueryPairs(queryPairs)
  return `${endpoint.origin}${encodedPath}${query ? `?${query}` : ''}`
}

function validateHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (
      SIGNING_CONTROLLED_HEADERS.has(lowerName) ||
      lowerName === 'opc-retry-token' ||
      Object.hasOwn(normalized, lowerName) ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      typeof value !== 'string' ||
      CONTROL_PATTERN.test(value)
    ) {
      throw new OciClientError('invalid_request')
    }
    normalized[lowerName] = value
  }
  return normalized
}

function validateRequest(request: OciRequest): {
  body?: Uint8Array
  headers: Record<string, string>
  queryPairs: readonly (readonly [string, string])[]
  attempts: number
  retryToken?: string
} {
  if (
    !REQUEST_METHODS.has(request.method) ||
    typeof request.encodedPath !== 'string' ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs <= 0 ||
    request.timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(request.maxResponseBytes) ||
    request.maxResponseBytes <= 0 ||
    request.maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES
  ) {
    throw new OciClientError('invalid_request')
  }
  if (
    request.headers !== undefined &&
    (!request.headers || typeof request.headers !== 'object' || Array.isArray(request.headers))
  ) {
    throw new OciClientError('invalid_request')
  }
  const bodyMethod = BODY_METHODS.has(request.method)
  if (
    (bodyMethod && (!(request.body instanceof Uint8Array) || request.contentType === undefined)) ||
    (!bodyMethod && (request.body !== undefined || request.contentType !== undefined))
  ) {
    throw new OciClientError('invalid_request')
  }
  if (
    request.contentType !== undefined &&
    (typeof request.contentType !== 'string' ||
      request.contentType.length === 0 ||
      request.contentType.length > 256 ||
      CONTROL_PATTERN.test(request.contentType))
  ) {
    throw new OciClientError('invalid_request')
  }
  const headers = validateHeaders(request.headers ?? {})
  if (request.queryPairs !== undefined && !Array.isArray(request.queryPairs)) {
    throw new OciClientError('invalid_request')
  }
  const queryPairs = (request.queryPairs ?? []).map((pair) => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    ) {
      throw new OciClientError('invalid_request')
    }
    return Object.freeze([pair[0], pair[1]] as const)
  })
  let attempts = 1
  let retryToken: string | undefined
  if (request.retry) {
    if (
      typeof request.retry !== 'object' ||
      Array.isArray(request.retry) ||
      (request.retry.kind !== 'safe' && request.retry.kind !== 'tokenized') ||
      (request.retry.kind === 'safe' && !SAFE_RETRY_METHODS.has(request.method)) ||
      Object.keys(request.retry).some(
        (key) =>
          key !== 'kind' &&
          key !== 'maxAttempts' &&
          !(request.retry?.kind === 'tokenized' && key === 'retryToken')
      ) ||
      !Number.isSafeInteger(request.retry.maxAttempts) ||
      request.retry.maxAttempts < 2 ||
      request.retry.maxAttempts > MAX_ATTEMPTS
    ) {
      throw new OciClientError('invalid_request')
    }
    attempts = request.retry.maxAttempts
    if (request.retry.kind === 'tokenized') {
      if (
        typeof request.retry.retryToken !== 'string' ||
        request.retry.retryToken.length === 0 ||
        Buffer.byteLength(request.retry.retryToken, 'utf8') > MAX_RETRY_TOKEN_BYTES ||
        CONTROL_PATTERN.test(request.retry.retryToken)
      ) {
        throw new OciClientError('invalid_request')
      }
      retryToken = request.retry.retryToken
    }
  }
  if (request.responseHeaders !== undefined && !Array.isArray(request.responseHeaders)) {
    throw new OciClientError('invalid_request')
  }
  for (const name of request.responseHeaders ?? []) {
    if (typeof name !== 'string' || !RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) {
      throw new OciClientError('invalid_request')
    }
  }
  return {
    ...(request.body !== undefined ? { body: new Uint8Array(request.body) } : {}),
    headers,
    queryPairs,
    attempts,
    ...(retryToken !== undefined ? { retryToken } : {}),
  }
}

function signRequest(params: {
  material: OciCredentialMaterial
  method: OciRequestMethod
  url: string
  headers: Readonly<Record<string, string>>
  body?: Uint8Array
  contentType?: string
  signingDate: Date
}): SignedOciRequest {
  const url = new URL(params.url)
  const headers: Record<string, string> = {
    ...params.headers,
    host: url.host,
    'x-date': params.signingDate.toUTCString(),
  }
  const headerNames = ['x-date', '(request-target)', 'host']
  if (params.body !== undefined) {
    headers['content-type'] = params.contentType!
    headers['content-length'] = String(params.body.byteLength)
    headers['x-content-sha256'] = createHash('sha256').update(params.body).digest('base64')
    headerNames.push('content-type', 'content-length', 'x-content-sha256')
  }
  const target = `${url.pathname}${url.search}`
  const signingString = headerNames
    .map((name) =>
      name === '(request-target)'
        ? `(request-target): ${params.method.toLowerCase()} ${target}`
        : `${name}: ${headers[name]}`
    )
    .join('\n')
  const signature = createSign('RSA-SHA256')
    .update(signingString)
    .end()
    .sign(params.material.privateKey, 'base64')
  const keyId = `${params.material.tenancyOcid}/${params.material.userOcid}/${params.material.fingerprint}`
  headers.authorization = `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${headerNames.join(' ')}",signature="${signature}"`
  return {
    url: params.url,
    headers,
    ...(params.body !== undefined ? { body: new Uint8Array(params.body) } : {}),
  }
}

function selectedResponseHeaders(
  response: SecureFetchResponse,
  requested: readonly string[]
): Readonly<Record<string, string>> {
  const selected = new Set(['content-type', 'etag', 'opc-request-id', ...requested.map(String)])
  const result: Record<string, string> = {}
  for (const name of selected) {
    const normalized = name.toLowerCase()
    if (!RESPONSE_HEADER_ALLOWLIST.has(normalized)) continue
    const value = response.headers.get(normalized)
    if (value !== null) result[normalized] = value
  }
  return Object.freeze(result)
}

async function readFailureCode(
  response: SecureFetchResponse,
  signal: AbortSignal
): Promise<string | undefined> {
  try {
    const body = await readResponseToBufferWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OCI error response',
      signal,
      allowNoBodyFallback: true,
    })
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const code = (parsed as Record<string, unknown>).code
    return typeof code === 'string' && code.length <= 128 ? code : undefined
  } catch (error) {
    await response.body?.cancel().catch(() => {})
    if (signal.aborted) throw toError(signal.reason ?? error)
    return undefined
  }
}

function isRetryableTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  return (
    (typeof code === 'string' && RETRYABLE_TRANSPORT_CODES.has(code)) ||
    /^Request timed out after \d+ms$/.test(error.message)
  )
}

function extractDiscoveredOrigin(
  policy: OciDiscoveredEndpointPolicy,
  snapshot: BoundResponseSnapshot
): string {
  if (policy.source.kind === 'header') {
    const value = snapshot.headers[policy.source.name]
    if (!value) throw new OciClientError('invalid_endpoint')
    return value
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(snapshot.body).toString('utf8'))
  } catch {
    throw new OciClientError('invalid_endpoint')
  }
  for (const segment of policy.source.path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new OciClientError('invalid_endpoint')
    }
    value = (value as Record<string, unknown>)[segment]
  }
  if (typeof value !== 'string') throw new OciClientError('invalid_endpoint')
  return value
}

function createDeadline(
  timeoutMs: number,
  callerSignal?: AbortSignal
): {
  signal: AbortSignal
  deadlineAt: number
  expired: () => boolean
  cleanup: () => void
} {
  const controller = new AbortController()
  let deadlineExpired = false
  const deadlineAt = Date.now() + timeoutMs
  const timer = setTimeout(() => {
    deadlineExpired = true
    controller.abort(new OciClientError('deadline_exceeded'))
  }, timeoutMs)
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  return {
    signal: controller.signal,
    deadlineAt,
    expired: () => deadlineExpired,
    cleanup: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function raceWithAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(toError(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(toError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    let pending: Promise<T>
    try {
      pending = operation()
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    pending.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  await raceWithAbort(() => sleep(delayMs), signal)
}

async function secureOciFetch(
  url: string,
  options: SecureFetchOptions,
  paramName: string,
  signal: AbortSignal
): Promise<SecureFetchResponse> {
  const validation = await raceWithAbort(
    () =>
      validateUrlWithDNS(url, paramName, options.profile, {
        logDetails: options.logUrlValidationDetails,
      }),
    signal
  )
  if (!validation.isValid) throw new Error(validation.error)
  return raceWithAbort(() => secureFetchWithPinnedIP(url, validation.resolvedIP, options), signal)
}

/** Creates a lazily loaded OCI client bound to trusted workspace and service context. */
export async function createOciClient(params: CreateOciClientParams): Promise<OciClient> {
  const service = getServiceConfigByServiceId(params.serviceId)
  if (service?.serviceAccountProviderId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID) {
    throw new OciClientError('invalid_endpoint')
  }

  let materialPromise: Promise<OciCredentialMaterial> | undefined
  let credentialMaterial: OciCredentialMaterial | undefined
  const preparedEndpoints = new WeakSet<object>()
  const endpointPolicies = new WeakMap<object, OciEndpointPolicy>()
  const responseSnapshots = new WeakMap<object, BoundResponseSnapshot>()

  const getMaterial = async () => {
    materialPromise ??= loadCredentialMaterial({
      credentialId: params.credentialId,
      workspaceId: params.workspaceId,
    })
    const material = await materialPromise
    credentialMaterial = material
    return material
  }
  const assertPolicyOwner = (policy: OciEndpointPolicy) => {
    if (policy.serviceId !== params.serviceId) throw new OciClientError('invalid_endpoint')
  }
  const effectiveRegion = async () => {
    const material = await getMaterial()
    return resolveEffectiveOciRegion(material.region, params.region)
  }
  const client: OciClient = {
    async prepareStaticEndpoint(policy) {
      assertPolicyOwner(policy)
      try {
        const endpoint = resolveStaticOciEndpoint(policy, await effectiveRegion())
        preparedEndpoints.add(endpoint)
        endpointPolicies.set(endpoint, policy)
        return endpoint
      } catch (error) {
        if (error instanceof OciClientError) throw error
        throw new OciClientError('invalid_endpoint')
      }
    },

    async prepareDiscoveredEndpoint(policy, response) {
      assertPolicyOwner(policy)
      const snapshot = responseSnapshots.get(response)
      if (!snapshot || snapshot.policy !== policy.responsePolicy) {
        throw new OciClientError('invalid_endpoint')
      }
      try {
        const origin = extractDiscoveredOrigin(policy, snapshot)
        const endpoint = resolveDiscoveredOciEndpoint(policy, snapshot.region, origin)
        preparedEndpoints.add(endpoint)
        endpointPolicies.set(endpoint, policy)
        return endpoint
      } catch (error) {
        if (error instanceof OciClientError) throw error
        throw new OciClientError('invalid_endpoint')
      }
    },

    async request(request) {
      if (
        !preparedEndpoints.has(request.endpoint) ||
        request.endpoint.serviceId !== params.serviceId
      ) {
        throw new OciClientError('invalid_endpoint')
      }
      const endpointPolicy = endpointPolicies.get(request.endpoint)
      if (!endpointPolicy) throw new OciClientError('invalid_endpoint')
      const material = credentialMaterial
      if (!material) throw new OciClientError('invalid_endpoint')
      const validated = validateRequest(request)
      const url = buildRequestUrl(request.endpoint, request.encodedPath, validated.queryPairs)
      const deadline = createDeadline(request.timeoutMs, request.signal)
      try {
        for (let attempt = 1; attempt <= validated.attempts; attempt += 1) {
          if (deadline.signal.aborted) {
            throw new OciClientError(deadline.expired() ? 'deadline_exceeded' : 'aborted')
          }
          const remainingMs = deadline.deadlineAt - Date.now()
          if (remainingMs <= 0) throw new OciClientError('deadline_exceeded')
          const signed = signRequest({
            material,
            method: request.method,
            url,
            headers: {
              ...validated.headers,
              ...(validated.retryToken ? { 'opc-retry-token': validated.retryToken } : {}),
            },
            body: validated.body,
            contentType: request.contentType,
            signingDate: new Date(),
          })

          let response: SecureFetchResponse
          try {
            response = await secureOciFetch(
              signed.url,
              {
                method: request.method,
                headers: { ...signed.headers },
                ...(signed.body !== undefined ? { body: new Uint8Array(signed.body) } : {}),
                timeout: Math.max(1, Math.floor(remainingMs)),
                maxResponseBytes: request.maxResponseBytes,
                maxRedirects: 0,
                signal: deadline.signal,
                profile: 'configuredEndpoint',
                logUrlValidationDetails: false,
              },
              'OCI destination',
              deadline.signal
            )
          } catch (error) {
            if (deadline.signal.aborted) {
              throw new OciClientError(deadline.expired() ? 'deadline_exceeded' : 'aborted')
            }
            if (isPayloadSizeLimitError(error)) {
              throw new OciClientError('response_too_large')
            }
            if (attempt < validated.attempts && isRetryableTransportFailure(error)) {
              const delay = backoffWithJitter(attempt, null, { baseMs: 200, maxMs: 5000 })
              if (delay >= deadline.deadlineAt - Date.now()) {
                throw new OciClientError('deadline_exceeded')
              }
              await waitForRetry(delay, deadline.signal)
              continue
            }
            throw new OciClientError('request_failed')
          }

          const opcRequestId = response.headers.get('opc-request-id')
          if (!response.ok) {
            const providerCode = await readFailureCode(response, deadline.signal)
            const retryable =
              RETRYABLE_STATUSES.has(response.status) ||
              (response.status === 409 && providerCode === 'IncorrectState')
            if (retryable && attempt < validated.attempts) {
              const retryAfter = parseRetryAfter(response.headers.get('retry-after'), 5000)
              const delay = backoffWithJitter(attempt, retryAfter, { baseMs: 200, maxMs: 5000 })
              if (delay >= deadline.deadlineAt - Date.now()) {
                throw new OciClientError('deadline_exceeded')
              }
              await waitForRetry(delay, deadline.signal)
              continue
            }
            throw new OciClientError('request_failed', {
              status: response.status,
              opcRequestId,
            })
          }

          let body: Uint8Array
          try {
            const buffer = await readResponseToBufferWithLimit(response, {
              maxBytes: request.maxResponseBytes,
              label: 'OCI response',
              signal: deadline.signal,
              requestMethod: request.method,
              allowNoBodyFallback: true,
            })
            body = new Uint8Array(buffer)
          } catch (error) {
            if (deadline.signal.aborted) {
              throw new OciClientError(deadline.expired() ? 'deadline_exceeded' : 'aborted')
            }
            if (isPayloadSizeLimitError(error)) throw new OciClientError('response_too_large')
            throw new OciClientError('request_failed')
          }
          const headers = selectedResponseHeaders(response, request.responseHeaders ?? [])
          const result = Object.freeze({
            status: response.status,
            headers,
            ...(opcRequestId ? { opcRequestId } : {}),
            body: new Uint8Array(body),
          }) as OciAuthenticatedResponse
          responseSnapshots.set(result, {
            status: response.status,
            headers,
            body: new Uint8Array(body),
            region: request.endpoint.region,
            policy: endpointPolicy,
          })
          return result
        }
        throw new OciClientError('request_failed')
      } catch (error) {
        if (error instanceof OciClientError) throw error
        if (deadline.signal.aborted) {
          throw new OciClientError(deadline.expired() ? 'deadline_exceeded' : 'aborted')
        }
        throw new OciClientError('request_failed')
      } finally {
        deadline.cleanup()
      }
    },
  }

  return Object.freeze(client)
}

/** @internal Performs only the fixed GetNamespace check used during credential setup. */
export async function verifyOciApiKeyCredentialForSetup(
  serializedSecret: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const material = parseCredentialMaterial(serializedSecret)
  const policy = createOciStaticEndpointPolicy({
    serviceId: OCI_SERVICE_ID,
    serviceName: 'objectstorage',
    hostnameTemplate: 'regional',
  })
  const endpoint = resolveStaticOciEndpoint(policy, resolveEffectiveOciRegion(material.region))
  const url = buildRequestUrl(endpoint, '/n/', [])
  const deadline = createDeadline(SETUP_VERIFICATION_TIMEOUT_MS, signal)
  try {
    const signed = signRequest({
      material,
      method: 'GET',
      url,
      headers: { accept: 'application/json' },
      signingDate: new Date(),
    })
    const response = await secureOciFetch(
      signed.url,
      {
        method: 'GET',
        headers: { ...signed.headers },
        timeout: SETUP_VERIFICATION_TIMEOUT_MS,
        maxResponseBytes: SETUP_VERIFICATION_RESPONSE_BYTES,
        maxRedirects: 0,
        signal: deadline.signal,
        profile: 'configuredEndpoint',
        logUrlValidationDetails: false,
      },
      'OCI credential verification destination',
      deadline.signal
    )
    if (!response.ok) {
      await readFailureCode(response, deadline.signal)
      throw new OciClientError('request_failed', {
        status: response.status,
        opcRequestId: response.headers.get('opc-request-id'),
      })
    }
    const body = await readResponseToBufferWithLimit(response, {
      maxBytes: SETUP_VERIFICATION_RESPONSE_BYTES,
      label: 'OCI credential verification response',
      signal: deadline.signal,
      allowNoBodyFallback: true,
    })
    return new Uint8Array(body)
  } catch (error) {
    if (error instanceof OciClientError) throw error
    if (deadline.signal.aborted) {
      throw new OciClientError(deadline.expired() ? 'deadline_exceeded' : 'aborted')
    }
    throw new OciClientError('request_failed')
  } finally {
    deadline.cleanup()
  }
}
