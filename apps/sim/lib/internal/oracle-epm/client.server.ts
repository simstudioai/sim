import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  defineOracleEpmDestination,
  getOracleEpmDestination,
} from '@/lib/internal/oracle-epm/destination'
import {
  getOracleEpmEndpoint,
  type OracleEpmEndpointDefinition,
} from '@/lib/internal/oracle-epm/endpoint'
import {
  oracleEpmErrorFromResponse,
  oracleEpmLocalError,
  validateOracleEpmCorrelationId,
} from '@/lib/internal/oracle-epm/errors'
import {
  getOracleEpmReturnedLinkPolicy,
  type OracleEpmReturnedLinkPolicyDefinition,
} from '@/lib/internal/oracle-epm/links'
import { getOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type {
  OracleEpmClientResponse,
  OracleEpmDestination,
  OracleEpmEndpoint,
  OracleEpmPathPart,
  OracleEpmQueryParameter,
  OracleEpmRequestInput,
  OracleEpmReturnedLinkPolicy,
  OracleEpmValidatedLink,
} from '@/lib/internal/oracle-epm/types'

const SAFE_TOKEN = /^[A-Za-z0-9+/]+={0,2}$/
const MALFORMED_UTF16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const FORBIDDEN_LINK_TEXT = /[\u0000-\u001f\u007f]/
const validatedLinks = new WeakMap<
  object,
  { owner: object; url: string; policy: OracleEpmReturnedLinkPolicyDefinition }
>()

function assertExactKeys(
  input: Readonly<Record<string, unknown>> | undefined,
  allowed: readonly string[]
): void {
  for (const key of Object.keys(input ?? {})) {
    if (!allowed.includes(key)) throw oracleEpmLocalError('invalid_input')
  }
  if (new Set(Object.keys(input ?? {})).size !== Object.keys(input ?? {}).length) {
    throw oracleEpmLocalError('invalid_input')
  }
}

function validatePathStructure(
  value: string,
  mode: 'segment' | 'repository-path' = 'segment'
): void {
  if (!value || FORBIDDEN_LINK_TEXT.test(value) || MALFORMED_UTF16.test(value)) {
    throw oracleEpmLocalError('invalid_input')
  }
  if (mode === 'repository-path') {
    if (
      /^[A-Za-z]:/.test(value) ||
      value.split(/[/\\]/).some((part) => !part || part === '.' || part === '..')
    ) {
      throw oracleEpmLocalError('invalid_input')
    }
  } else if (value === '.' || value === '..' || /[/\\]/.test(value)) {
    throw oracleEpmLocalError('invalid_input')
  }
}

/** Validates raw caller input without decoding or rewriting the filename. */
function validatePathValue(
  value: unknown,
  declaration: Extract<OracleEpmPathPart, { kind: 'parameter' }>
): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > declaration.maxBytes ||
    (declaration.pattern && !declaration.pattern.test(value))
  ) {
    throw oracleEpmLocalError('invalid_input')
  }
  validatePathStructure(value, declaration.mode)
  return value
}

function buildPath(
  parts: readonly OracleEpmPathPart[],
  values: Readonly<Record<string, string>> | undefined
): string[] {
  const parameterNames = parts
    .filter(
      (part): part is Extract<OracleEpmPathPart, { kind: 'parameter' }> => part.kind === 'parameter'
    )
    .map((part) => part.name)
  assertExactKeys(values, parameterNames)
  return parts.map((part) => {
    if (part.kind === 'literal') return part.value
    return validatePathValue(values?.[part.name], part)
  })
}

function serializeQueryValue(value: unknown, declaration: OracleEpmQueryParameter): string {
  if (declaration.kind === 'string') {
    if (
      typeof value !== 'string' ||
      MALFORMED_UTF16.test(value) ||
      Buffer.byteLength(value, 'utf8') > declaration.maxBytes ||
      (declaration.pattern && !declaration.pattern.test(value))
    )
      throw oracleEpmLocalError('invalid_input')
    return value
  }
  if (declaration.kind === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < declaration.minimum ||
      value > declaration.maximum
    )
      throw oracleEpmLocalError('invalid_input')
    return String(value)
  }
  if (typeof value !== 'boolean') throw oracleEpmLocalError('invalid_input')
  return String(value)
}

function buildQuery(
  declarations: Readonly<Record<string, OracleEpmQueryParameter>>,
  values: Readonly<Record<string, string | number | boolean | undefined>> | undefined
): URLSearchParams {
  assertExactKeys(values, Object.keys(declarations))
  const query = new URLSearchParams()
  for (const [name, declaration] of Object.entries(declarations)) {
    const value = values?.[name]
    if (value === undefined) {
      if (declaration.required) throw oracleEpmLocalError('invalid_input')
      continue
    }
    query.set(name, serializeQueryValue(value, declaration))
  }
  return query
}

function buildHeaders(
  declarations: OracleEpmEndpointDefinition['headers'],
  values: OracleEpmRequestInput['headers'],
  accessToken: string,
  bodyMode: OracleEpmEndpointDefinition['body'],
  responseMode: OracleEpmEndpointDefinition['response']
): Record<string, string> {
  const declared = declarations ?? {}
  assertExactKeys(values, Object.keys(declared))
  const headers: Record<string, string> = {
    Authorization: `Basic ${accessToken}`,
    Accept: responseMode === 'json' ? 'application/json' : '*/*',
  }
  for (const [inputName, declaration] of Object.entries(declared)) {
    const value = values?.[inputName]
    if (value === undefined) {
      if (declaration.required) throw oracleEpmLocalError('invalid_input')
      continue
    }
    if (
      /\r|\n|\u0000/.test(value) ||
      MALFORMED_UTF16.test(value) ||
      Buffer.byteLength(value, 'utf8') > declaration.maxBytes ||
      (declaration.pattern && !declaration.pattern.test(value))
    )
      throw oracleEpmLocalError('invalid_input')
    headers[declaration.name] = value
  }
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  if (bodyMode === 'json' && !hasContentType) headers['Content-Type'] = 'application/json'
  if (bodyMode === 'stream' && !hasContentType) headers['Content-Type'] = 'application/octet-stream'
  return headers
}

type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData }

function hasPrototypeToJson(value: object): boolean {
  let prototype = Object.getPrototypeOf(value)
  while (prototype) {
    if (Object.getOwnPropertyDescriptor(prototype, 'toJSON')) return true
    prototype = Object.getPrototypeOf(prototype)
  }
  return false
}

/** Copies only ordinary JSON data without invoking accessors or custom serializers. */
function cloneJsonData(value: unknown, ancestors = new WeakSet<object>()): JsonData {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value !== 'object') throw oracleEpmLocalError('invalid_input')
  if (ancestors.has(value)) throw oracleEpmLocalError('invalid_input')

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || hasPrototypeToJson(value)) {
      throw oracleEpmLocalError('invalid_input')
    }
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.some(
        (key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      )
    ) {
      throw oracleEpmLocalError('invalid_input')
    }
    ancestors.add(value)
    try {
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw oracleEpmLocalError('invalid_input')
        }
        return cloneJsonData(descriptor.value, ancestors)
      })
    } finally {
      ancestors.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw oracleEpmLocalError('invalid_input')
  }
  const clone: { [key: string]: JsonData } = Object.create(null)
  ancestors.add(value)
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw oracleEpmLocalError('invalid_input')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw oracleEpmLocalError('invalid_input')
      }
      clone[key] = cloneJsonData(descriptor.value, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
  return clone
}

function buildBody(
  endpoint: OracleEpmEndpointDefinition,
  input: OracleEpmRequestInput
): string | Uint8Array | undefined {
  if (endpoint.body === 'none') {
    if (input.json !== undefined || input.stream !== undefined)
      throw oracleEpmLocalError('invalid_input')
    return undefined
  }
  if (endpoint.body === 'json') {
    if (input.json === undefined || input.stream !== undefined)
      throw oracleEpmLocalError('invalid_input')
    let body: string
    try {
      body = JSON.stringify(cloneJsonData(input.json))
    } catch {
      throw oracleEpmLocalError('invalid_input')
    }
    if (typeof body !== 'string') throw oracleEpmLocalError('invalid_input')
    if (Buffer.byteLength(body, 'utf8') > (endpoint.maxRequestBytes ?? 0)) {
      throw oracleEpmLocalError('payload_too_large')
    }
    return body
  }
  if (!(input.stream instanceof Uint8Array) || input.json !== undefined)
    throw oracleEpmLocalError('invalid_input')
  if (input.stream.byteLength > (endpoint.maxRequestBytes ?? 0)) {
    throw oracleEpmLocalError('payload_too_large')
  }
  return input.stream
}

function getCorrelationId(
  response: SecureFetchResponse,
  endpoint: OracleEpmEndpointDefinition
): string | undefined {
  return endpoint.errors?.correlationHeaders
    ?.map((name) => validateOracleEpmCorrelationId(response.headers.get(name)))
    .find((value): value is string => value !== undefined)
}

async function projectResponse(
  response: SecureFetchResponse,
  endpoint: OracleEpmEndpointDefinition
): Promise<OracleEpmClientResponse> {
  const correlationId = getCorrelationId(response, endpoint)
  if (endpoint.response === 'empty') {
    await response.body?.cancel().catch(() => undefined)
    return Object.freeze({ status: response.status, correlationId })
  }
  if (endpoint.response === 'stream') {
    if (!response.body) throw oracleEpmLocalError('invalid_response')
    const rawLength = response.headers.get('content-length')
    const parsedLength = rawLength === null ? undefined : Number.parseInt(rawLength, 10)
    return Object.freeze({
      status: response.status,
      body: response.body,
      ...(Number.isSafeInteger(parsedLength) && parsedLength !== undefined && parsedLength >= 0
        ? { contentLength: parsedLength }
        : {}),
      ...(response.headers.get('content-type')
        ? { contentType: response.headers.get('content-type') ?? undefined }
        : {}),
      correlationId,
    })
  }
  try {
    const data = await response.json()
    return Object.freeze({ status: response.status, data, correlationId })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) throw oracleEpmLocalError('payload_too_large')
    throw oracleEpmLocalError('invalid_response')
  }
}

/** Decodes one wire segment; additional decoded copies are only inspected for safety. */
function decodeReturnedPathSegment(
  encoded: string,
  mode: 'segment' | 'repository-path' = 'segment'
): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    throw oracleEpmLocalError('invalid_input')
  }
  let safetyValue = decoded
  if (mode === 'repository-path') validatePathStructure(safetyValue, mode)
  for (let depth = 0; depth < 4 && /%[0-9A-Fa-f]{2}/.test(safetyValue); depth += 1) {
    try {
      safetyValue = decodeURIComponent(safetyValue)
    } catch {
      throw oracleEpmLocalError('invalid_input')
    }
    if (mode === 'repository-path') validatePathStructure(safetyValue, mode)
  }
  if (/%[0-9A-Fa-f]{2}/.test(safetyValue)) {
    throw oracleEpmLocalError('invalid_input')
  }
  validatePathStructure(safetyValue, mode)
  return decoded
}

function rawReturnedPathSegments(href: string): string[] {
  const match = /^https:\/\/[^/?#]*(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(href)
  if (!match) throw oracleEpmLocalError('invalid_input')
  const rawPath = match[1] ?? ''
  if (rawPath.includes('\\')) throw oracleEpmLocalError('invalid_input')
  if (!rawPath) return []
  const segments = rawPath.slice(1).split('/')
  if (segments.some((segment) => !segment)) throw oracleEpmLocalError('invalid_input')
  return segments
}

function matchReturnedPath(
  candidate: readonly string[],
  expected: readonly OracleEpmPathPart[]
): void {
  if (candidate.length !== expected.length) throw oracleEpmLocalError('invalid_input')
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index]
    const decoded = decodeReturnedPathSegment(
      candidate[index],
      part.kind === 'parameter' ? part.mode : undefined
    )
    if (part.kind === 'literal') {
      if (decoded !== part.value) throw oracleEpmLocalError('invalid_input')
    } else {
      validatePathValue(decoded, part)
    }
  }
}

/** Fixed-origin client that consumes only branded declarations and link capabilities. */
export interface OracleEpmClient {
  request(
    endpoint: OracleEpmEndpoint,
    input?: OracleEpmRequestInput
  ): Promise<OracleEpmClientResponse>
  validateReturnedLink(
    policy: OracleEpmReturnedLinkPolicy,
    link: { rel: string; href: string; method?: string }
  ): OracleEpmValidatedLink
  requestValidatedLink(
    link: OracleEpmValidatedLink,
    signal?: AbortSignal
  ): Promise<OracleEpmClientResponse>
}

/** Creates a fixed-destination Oracle EPM client from resolved credential material. */
export function createOracleEpmClient(input: {
  instanceUrl: string
  accessToken: string
}): OracleEpmClient {
  const destination: OracleEpmDestination = defineOracleEpmDestination(input.instanceUrl)
  const destinationData = getOracleEpmDestination(destination)
  if (!input.accessToken || input.accessToken.length > 4_096 || !SAFE_TOKEN.test(input.accessToken))
    throw oracleEpmLocalError('invalid_configuration')
  const owner = Object.freeze({})

  const perform = async (
    url: string,
    endpoint: OracleEpmEndpointDefinition,
    request: OracleEpmRequestInput = {}
  ): Promise<OracleEpmClientResponse> => {
    const body = buildBody(endpoint, request)
    const headers = buildHeaders(
      endpoint.headers,
      request.headers,
      input.accessToken,
      endpoint.body,
      endpoint.response
    )
    const deadlineSignal = AbortSignal.timeout(endpoint.timeoutMs)
    const signal = request.signal
      ? AbortSignal.any([request.signal, deadlineSignal])
      : deadlineSignal
    const validation = await validateUrlWithDNS(
      destinationData.origin,
      'Oracle EPM destination',
      'configuredEndpoint',
      { logDetails: false }
    )
    if (request.signal?.aborted) {
      throw request.signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    if (deadlineSignal.aborted) throw oracleEpmLocalError('timeout', true)
    if (!validation.isValid) throw oracleEpmLocalError('invalid_configuration')
    const maxAttempts =
      endpoint.method === 'GET' ? Math.min(endpoint.retry?.maxAttempts ?? 1, 2) : 1
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: SecureFetchResponse
      try {
        response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
          profile: 'configuredEndpoint',
          method: endpoint.method,
          headers,
          body,
          timeout: endpoint.timeoutMs,
          maxRedirects: 0,
          maxResponseBytes: endpoint.maxResponseBytes,
          signal,
          logUrlValidationDetails: false,
        })
      } catch (error) {
        if (isPayloadSizeLimitError(error)) throw oracleEpmLocalError('payload_too_large')
        if (request.signal?.aborted) throw request.signal.reason ?? error
        if (deadlineSignal.aborted) throw oracleEpmLocalError('timeout', true)
        throw oracleEpmLocalError(
          error instanceof Error && /timed out/i.test(error.message)
            ? 'timeout'
            : 'service_unavailable',
          true
        )
      }
      if (response.ok) {
        try {
          return await projectResponse(response, endpoint)
        } catch (error) {
          if (request.signal?.aborted) {
            throw request.signal.reason ?? error
          }
          if (deadlineSignal.aborted) throw oracleEpmLocalError('timeout', true)
          throw error
        }
      }
      const retryable = Boolean(endpoint.retry?.statuses.includes(response.status))
      if (!retryable || attempt === maxAttempts)
        throw await oracleEpmErrorFromResponse(response, endpoint.errors, retryable)
      await response.body?.cancel().catch(() => undefined)
      const delay = backoffWithJitter(attempt, null, {
        baseMs: endpoint.retry?.initialDelayMs,
        maxMs: endpoint.retry?.maxDelayMs,
      })
      try {
        await interruptibleSleep(delay, signal)
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason ?? error
        if (deadlineSignal.aborted) throw oracleEpmLocalError('timeout', true)
        throw error
      }
    }
    throw oracleEpmLocalError('service_unavailable', true)
  }

  const client: OracleEpmClient = Object.freeze({
    async request(endpointValue: OracleEpmEndpoint, request: OracleEpmRequestInput = {}) {
      const endpoint = getOracleEpmEndpoint(endpointValue)
      const route = getOracleEpmRouteSpace(endpoint.routeSpace)
      const path = [
        ...destinationData.baseSegments,
        ...route.context,
        endpoint.version,
        ...buildPath(endpoint.path, request.pathParams),
      ]
      const url = new URL(`${destinationData.origin}/${path.map(encodeURIComponent).join('/')}`)
      const query = buildQuery(endpoint.query ?? {}, request.query)
      url.search = query.toString()
      return perform(url.toString(), endpoint, request)
    },
    validateReturnedLink(
      policyValue: OracleEpmReturnedLinkPolicy,
      link: { rel: string; href: string; method?: string }
    ) {
      const policy = getOracleEpmReturnedLinkPolicy(policyValue)
      if (
        link.rel !== policy.relation ||
        (link.method !== undefined && link.method !== policy.method) ||
        typeof link.href !== 'string' ||
        link.href.length > 8_192 ||
        FORBIDDEN_LINK_TEXT.test(link.href) ||
        MALFORMED_UTF16.test(link.href) ||
        link.href.includes('#')
      )
        throw oracleEpmLocalError('invalid_input')
      const candidate = rawReturnedPathSegments(link.href)
      let url: URL
      try {
        url = new URL(link.href)
      } catch {
        throw oracleEpmLocalError('invalid_input')
      }
      if (url.origin !== destinationData.origin || url.username || url.password || url.hash)
        throw oracleEpmLocalError('invalid_input')
      const route = getOracleEpmRouteSpace(policy.routeSpace)
      const prefix = [
        ...(policy.preserveGatewayBasePath ? destinationData.baseSegments : []),
        ...route.context,
        policy.version,
      ]
      if (
        candidate.length !== prefix.length + policy.path.length ||
        prefix.some((part, index) => decodeReturnedPathSegment(candidate[index]) !== part)
      ) {
        throw oracleEpmLocalError('invalid_input')
      }
      matchReturnedPath(candidate.slice(prefix.length), policy.path)
      const seen = new Set<string>()
      for (const [name, value] of url.searchParams) {
        if (seen.has(name) || !Object.hasOwn(policy.query, name))
          throw oracleEpmLocalError('invalid_input')
        seen.add(name)
        serializeQueryValue(value, policy.query[name])
      }
      for (const [name, declaration] of Object.entries(policy.query)) {
        if (declaration.required && !seen.has(name)) throw oracleEpmLocalError('invalid_input')
      }
      const handle = Object.freeze({}) as OracleEpmValidatedLink
      validatedLinks.set(handle, { owner, url: url.toString(), policy })
      return handle
    },
    async requestValidatedLink(handle: OracleEpmValidatedLink, signal?: AbortSignal) {
      const value = validatedLinks.get(handle)
      if (!value || value.owner !== owner) throw oracleEpmLocalError('invalid_input')
      return perform(value.url, value.policy.endpoint, { signal })
    },
  })
  return client
}
