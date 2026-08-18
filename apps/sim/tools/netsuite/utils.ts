import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { normalizeNetSuiteSuiteTalkOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import type {
  NetSuiteAuthParams,
  NetSuiteBatchWriteParams,
  NetSuiteJsonObject,
  NetSuiteResponse,
} from '@/tools/netsuite/types'
import type { HttpMethod, ToolConfig } from '@/tools/types'

const SUITETALK_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 1_000
const MAX_PAGE_COUNT = 1_000
const MAX_RESULT_COUNT = 100_000
const MAX_BATCH_RECORDS = 100
const MAX_JSON_NESTING_DEPTH = 100
const MAX_JSON_NODE_COUNT = 100_000
type NetSuiteSuccessValidator =
  | 'collection-page'
  | 'suiteql-page'
  | 'record-action'
  | 'metadata-catalog'
  | 'async-job'
  | 'async-task-collection'
  | 'async-task'
  | 'server-time'
  | 'governance-limits'

interface NetSuiteSuccessCase {
  status: number
  body: 'none' | 'object' | 'optional-object'
  validator?: NetSuiteSuccessValidator
}

interface NetSuiteRequest {
  method: HttpMethod
  path: string
  success: NetSuiteSuccessCase | readonly NetSuiteSuccessCase[]
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  body?: unknown
  /**
   * How a `Location` response header is treated. Oracle documents the header
   * for {@link https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545141395.html create}
   * and {@link https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1545142173.html update},
   * so `resource` requires it. Upsert and transform also produce a record but
   * Oracle documents no response headers for them, so `resource-optional`
   * surfaces the header when NetSuite sends it without failing when it does not.
   */
  responseLocation?: 'resource' | 'resource-optional' | 'async-job'
}

/**
 * Authentication fields shared by every NetSuite tool. Long-lived OAuth
 * signing material stays in the selected reusable credential; tools receive
 * only the short-lived token and SuiteTalk origin injected by the executor.
 */
export const netsuiteAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'NetSuite OAuth 2.0 client-credentials service account',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Short-lived access token injected by the executor from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'SuiteTalk account origin injected by the executor from the selected credential',
  },
} satisfies ToolConfig['params']

export function encodePathSegment(value: string, label: string): string {
  const trimmed = requiredTrim(value, label)
  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${label} cannot be a dot path segment`)
  }
  if (trimmed.startsWith('eid:') && !/^[A-Za-z0-9_-]+$/.test(trimmed.slice(4))) {
    throw new Error(
      `${label} external ID must contain only letters, numbers, underscores, and hyphens`
    )
  }
  return encodeURIComponent(trimmed).replace(/%3A/gi, ':').replace(/%40/gi, '@')
}

export function buildRecordPath(...segments: Array<{ value: string; label: string }>): string {
  return `/services/rest/record/v1/${segments
    .map(({ value, label }) => encodePathSegment(value, label))
    .join('/')}`
}

export function buildSubresourcePath(value: string): Array<{ value: string; label: string }> {
  const segments = requiredTrim(value, 'Subresource path')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) throw new Error('Subresource path is required')
  return segments.map((segment) => ({ value: segment, label: 'Subresource path segment' }))
}

export function normalizePagination(
  requestedLimit?: number,
  requestedOffset?: number
): { limit: number; offset: number } {
  const limit = requestedLimit ?? DEFAULT_PAGE_LIMIT
  const offset = requestedOffset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(`Limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`)
  }
  if (!Number.isInteger(offset) || offset < 0 || offset % limit !== 0) {
    throw new Error('Offset must be a non-negative integer divisible by limit')
  }
  if (offset + limit > MAX_RESULT_COUNT) {
    throw new Error(`Offset and limit must stay within NetSuite's first 100,000 results`)
  }
  if (offset / limit >= MAX_PAGE_COUNT) {
    throw new Error(`Offset must select one of NetSuite's first ${MAX_PAGE_COUNT} pages`)
  }
  return { limit, offset }
}

export function normalizeBatchItems(items: NetSuiteJsonObject[]): NetSuiteJsonObject[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH_RECORDS) {
    throw new Error(`Batch items must contain between 1 and ${MAX_BATCH_RECORDS} records`)
  }
  if (items.some((item) => !isRecordLike(item))) {
    throw new Error('Every batch item must be a JSON object')
  }
  return items
}

export function buildBatchWriteRequest(
  method: 'POST' | 'PATCH' | 'PUT',
  params: NetSuiteBatchWriteParams
): NetSuiteRequest {
  const items = normalizeBatchItems(params.items)
  const idempotencyKey = optionalTrim(params.idempotencyKey, 'Idempotency key')
  validateBatchWriteIdentifiers(method, items)
  return {
    method,
    path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
    success: { status: 202, body: 'none' },
    responseLocation: 'async-job',
    headers: {
      Prefer: 'respond-async',
      'Content-Type': 'application/vnd.oracle.resource+json; type=collection',
      ...(idempotencyKey ? { 'X-NetSuite-idempotency-key': idempotencyKey } : {}),
    },
    body: { items },
  }
}

function validateBatchWriteIdentifiers(
  method: 'POST' | 'PATCH' | 'PUT',
  items: NetSuiteJsonObject[]
): void {
  if (method === 'POST') return

  const invalidIndex = items.findIndex((item) => {
    if (method === 'PUT') {
      return !isNonEmptyString(item.externalId) || item.id !== undefined
    }
    return !hasBatchInternalId(item.id) && !isNonEmptyString(item.externalId)
  })
  if (invalidIndex === -1) return

  const requirement =
    method === 'PUT'
      ? 'a non-empty string externalId and must not include id'
      : 'an id or non-empty string externalId'
  throw new Error(`Batch item ${invalidIndex + 1} must include ${requirement}`)
}

function hasBatchInternalId(value: unknown): boolean {
  if (isNonEmptyString(value)) return true
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

export function normalizeBatchIds(ids: string): string {
  const values = requiredTrim(ids, 'IDs')
    .split(',')
    .map((id) => id.trim())
  if (values.some((id) => !id)) {
    throw new Error('IDs must not contain empty comma-separated values')
  }
  if (values.length < 1 || values.length > MAX_BATCH_RECORDS) {
    throw new Error(`IDs must contain between 1 and ${MAX_BATCH_RECORDS} comma-separated values`)
  }
  return values.join(',')
}

export function optionalTrim(value?: string, label = 'Value'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const trimmed = value.trim()
  return trimmed || undefined
}

export function requiredTrim(value: string, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

export function normalizeOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function normalizeRelatedType(value: string): 'contact' | 'file' {
  const normalized = requiredTrim(value, 'Related type').toLowerCase()
  if (normalized !== 'contact' && normalized !== 'file') {
    throw new Error('Related type must be contact or file')
  }
  return normalized
}

export function normalizeSuiteTalkUrl(suiteTalkUrl: string): string {
  const value = requiredTrim(suiteTalkUrl, 'SuiteTalk URL')
  const origin = normalizeNetSuiteSuiteTalkOrigin(value)
  if (origin) return origin
  throw new Error(
    'SuiteTalk URL must be an HTTPS NetSuite Company URL with no path, query, or fragment'
  )
}

export async function executeNetSuiteRequest(
  auth: NetSuiteAuthParams,
  buildRequest: () => NetSuiteRequest,
  signal?: AbortSignal
): Promise<NetSuiteResponse> {
  let normalizedAuth: NetSuiteAuthParams | undefined
  let suiteTalkTimeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const request = buildRequest()
    if (request.body !== undefined && !isRecordLike(request.body)) {
      throw new Error('NetSuite request body must be a JSON object')
    }
    const serializedBody = serializeRequestBody(request.body)
    normalizedAuth = normalizeAuthParams(auth)
    const origin = normalizeSuiteTalkUrl(normalizedAuth.instanceUrl ?? '')
    const accessToken = requiredTrim(normalizedAuth.accessToken ?? '', 'NetSuite access token')
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
    const suiteTalkTimeoutController = new AbortController()
    suiteTalkTimeoutId = setTimeout(
      () =>
        suiteTalkTimeoutController.abort(
          new DOMException('NetSuite SuiteTalk request timed out', 'TimeoutError')
        ),
      SUITETALK_REQUEST_TIMEOUT_MS
    )
    const suiteTalkSignal = signal
      ? AbortSignal.any([signal, suiteTalkTimeoutController.signal])
      : suiteTalkTimeoutController.signal
    const response = await sendSuiteTalkRequest(
      origin,
      request,
      serializedBody,
      accessToken,
      suiteTalkSignal
    )

    const { location, jobId } = validateResponseLocation(
      response.headers.get('location'),
      origin,
      request.responseLocation
    )
    let data: unknown | null
    try {
      data = await readSuiteTalkBody(response, suiteTalkSignal)
    } catch (error) {
      return {
        success: false,
        output: {
          status: response.status,
          data: null,
          ...(location ? { location } : {}),
          ...(jobId ? { jobId } : {}),
        },
        error: sanitizeErrorText(
          getErrorMessage(error, 'NetSuite response processing failed'),
          normalizedAuth
        ),
      }
    }
    if (
      !response.ok &&
      location &&
      jobId &&
      isIdempotentJobReplay(request, response.status, data)
    ) {
      return {
        success: true,
        output: { status: response.status, data: null, location, jobId },
      }
    }
    if (!response.ok) {
      return {
        success: false,
        output: {
          status: response.status,
          data: null,
          ...(location ? { location } : {}),
          ...(jobId ? { jobId } : {}),
        },
        error: extractNetSuiteError(data, response.status, normalizedAuth),
      }
    }

    const successCase = getSuccessCase(request.success, response.status)
    if (!successCase) {
      const expectedStatuses = getSuccessCases(request.success)
        .map(({ status }) => `HTTP ${status}`)
        .join(' or ')
      return {
        success: false,
        output: {
          status: response.status,
          data,
          ...(location ? { location } : {}),
          ...(jobId ? { jobId } : {}),
        },
        error: `NetSuite returned HTTP ${response.status}; expected ${expectedStatuses}`,
      }
    }

    const contractError = validateSuccessBody(successCase, data)
    if (contractError) {
      return {
        success: false,
        output: {
          status: response.status,
          data,
          ...(location ? { location } : {}),
          ...(jobId ? { jobId } : {}),
        },
        error: contractError,
      }
    }

    if (request.responseLocation === 'resource' && !location) {
      return {
        success: false,
        output: { status: response.status, data },
        error: 'NetSuite success response did not include a valid resource Location header',
      }
    }

    if (expectsAsyncJob(request) && (!location || !jobId)) {
      return {
        success: false,
        output: {
          status: response.status,
          data,
          ...(location ? { location } : {}),
        },
        error: 'NetSuite asynchronous response did not include a valid job Location header',
      }
    }

    return {
      success: true,
      output: {
        status: response.status,
        data,
        ...(location ? { location } : {}),
        ...(jobId ? { jobId } : {}),
      },
    }
  } catch (error) {
    return {
      success: false,
      output: { status: 0, data: null },
      error: sanitizeErrorText(
        getErrorMessage(error, 'NetSuite request failed'),
        normalizedAuth ?? auth
      ),
    }
  } finally {
    if (suiteTalkTimeoutId) clearTimeout(suiteTalkTimeoutId)
  }
}

async function sendSuiteTalkRequest(
  origin: string,
  request: NetSuiteRequest,
  serializedBody: string | undefined,
  accessToken: string,
  signal?: AbortSignal
): Promise<Response> {
  if (!request.path.startsWith('/services/rest/') || request.path.includes('://')) {
    throw new Error('Invalid NetSuite REST path')
  }
  const url = new URL(request.path, origin)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...request.headers,
  }
  const hasBody = serializedBody !== undefined
  if (hasBody) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
    if (request.path.startsWith('/services/rest/record/')) {
      headers['X-NetSuite-PropertyNameValidation'] = 'error'
    }
  }
  return fetch(url, {
    method: request.method,
    headers,
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
    redirect: 'error',
    signal,
  })
}

async function readSuiteTalkBody(
  response: Response,
  signal?: AbortSignal
): Promise<unknown | null> {
  if (
    response.status === 204 ||
    response.status === 205 ||
    response.headers.get('content-length') === '0'
  ) {
    return null
  }
  const text = await readResponseTextWithLimit(response, {
    maxBytes: response.ok ? MAX_INLINE_MATERIALIZATION_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES,
    label: response.ok ? 'NetSuite response' : 'NetSuite error response',
    signal,
  })
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (response.ok) throw new Error('NetSuite returned a non-JSON success response')
    return text
  }
}

function serializeRequestBody(body: unknown): string | undefined {
  if (body === undefined) return undefined
  assertJsonBodyWithinLimit(body)
  const serializedBody = JSON.stringify(body)
  if (serializedBody === undefined) {
    throw new Error('NetSuite request body must be JSON serializable')
  }
  if (Buffer.byteLength(serializedBody, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
    throw new Error('NetSuite request body exceeds the inline payload limit')
  }
  return serializedBody
}

interface JsonBudgetState {
  bytes: number
  nodes: number
  ancestors: WeakSet<object>
}

type JsonBudgetFrame =
  | { kind: 'value'; value: unknown; depth: number }
  | { kind: 'array'; value: unknown[]; index: number; depth: number }
  | {
      kind: 'object'
      value: Record<string, unknown>
      keys: IterableIterator<string>
      emitted: boolean
      depth: number
    }

function assertJsonBodyWithinLimit(body: unknown): void {
  const state: JsonBudgetState = { bytes: 0, nodes: 0, ancestors: new WeakSet<object>() }
  const frames: JsonBudgetFrame[] = [{ kind: 'value', value: body, depth: 0 }]

  while (frames.length > 0) {
    const frame = frames.pop()
    if (!frame) break

    if (frame.kind === 'array') {
      if (frame.index >= frame.value.length) {
        addJsonBytes(state, 1)
        state.ancestors.delete(frame.value)
        continue
      }
      if (frame.index > 0) addJsonBytes(state, 1)
      const descriptor = Object.getOwnPropertyDescriptor(frame.value, String(frame.index))
      if (descriptor?.get || descriptor?.set) throwNonPlainJsonError()
      const value = descriptor ? descriptor.value : null
      frames.push({ ...frame, index: frame.index + 1 })
      frames.push({
        kind: 'value',
        value: isOmittedObjectJsonValue(value) ? null : value,
        depth: frame.depth + 1,
      })
      continue
    }

    if (frame.kind === 'object') {
      let next = frame.keys.next()
      while (!next.done) {
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, next.value)
        if (descriptor?.get || descriptor?.set) throwNonPlainJsonError()
        const value = descriptor?.value
        if (!isOmittedObjectJsonValue(value)) {
          if (frame.emitted) addJsonBytes(state, 1)
          addJsonBytes(state, jsonStringByteLength(next.value) + 1)
          frames.push({ ...frame, emitted: true })
          frames.push({ kind: 'value', value, depth: frame.depth + 1 })
          break
        }
        next = frame.keys.next()
      }
      if (next.done) {
        addJsonBytes(state, 1)
        state.ancestors.delete(frame.value)
      }
      continue
    }

    admitJsonNode(state)
    const { value, depth } = frame
    if (depth > MAX_JSON_NESTING_DEPTH) {
      throw new Error(`NetSuite request body exceeds the JSON nesting limit`)
    }
    if (value === null) {
      addJsonBytes(state, 4)
    } else if (typeof value === 'string') {
      addJsonBytes(state, jsonStringByteLength(value))
    } else if (typeof value === 'boolean') {
      addJsonBytes(state, value ? 4 : 5)
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throwNonPlainJsonError()
      addJsonBytes(state, JSON.stringify(value).length)
    } else if (Array.isArray(value)) {
      rejectCustomJsonSerialization(value)
      if (state.ancestors.has(value)) throw new Error('NetSuite request body must not be cyclic')
      if (value.length * 2 + 1 > MAX_INLINE_MATERIALIZATION_BYTES - state.bytes) {
        throwRequestBodyLimitError()
      }
      state.ancestors.add(value)
      addJsonBytes(state, 1)
      frames.push({ kind: 'array', value, index: 0, depth })
    } else if (isRecordLike(value)) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throwNonPlainJsonError()
      rejectCustomJsonSerialization(value)
      if (state.ancestors.has(value)) throw new Error('NetSuite request body must not be cyclic')
      state.ancestors.add(value)
      addJsonBytes(state, 1)
      frames.push({
        kind: 'object',
        value,
        keys: enumerableOwnStringKeys(value),
        emitted: false,
        depth,
      })
    } else {
      throwNonPlainJsonError()
    }
  }
}

function* enumerableOwnStringKeys(value: Record<string, unknown>): IterableIterator<string> {
  for (const key in value) {
    if (Object.hasOwn(value, key)) yield key
  }
}

function rejectCustomJsonSerialization(value: object): void {
  if (Object.hasOwn(value, 'toJSON')) throwNonPlainJsonError()
}

function isOmittedObjectJsonValue(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol'
}

function admitJsonNode(state: JsonBudgetState): void {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODE_COUNT) {
    throw new Error('NetSuite request body exceeds the JSON complexity limit')
  }
}

function addJsonBytes(state: JsonBudgetState, bytes: number): void {
  state.bytes += bytes
  if (state.bytes > MAX_INLINE_MATERIALIZATION_BYTES) throwRequestBodyLimitError()
}

function jsonStringByteLength(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      bytes += 2
    } else if (code < 0x20) {
      bytes +=
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
    } else if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function throwRequestBodyLimitError(): never {
  throw new Error('NetSuite request body exceeds the inline payload limit')
}

function throwNonPlainJsonError(): never {
  throw new Error(
    'NetSuite request body must contain plain JSON data without accessors or custom serialization'
  )
}

function getSuccessCases(contract: NetSuiteRequest['success']): readonly NetSuiteSuccessCase[] {
  return Array.isArray(contract) ? contract : [contract as NetSuiteSuccessCase]
}

function getSuccessCase(
  contract: NetSuiteRequest['success'],
  status: number
): NetSuiteSuccessCase | undefined {
  return getSuccessCases(contract).find((candidate) => candidate.status === status)
}

function validateSuccessBody(
  successCase: NetSuiteSuccessCase,
  data: unknown | null
): string | null {
  if (successCase.body === 'none' && data !== null) {
    return `NetSuite HTTP ${successCase.status} response unexpectedly included a body`
  }
  if (successCase.body === 'object' && !isRecordLike(data)) {
    return `NetSuite HTTP ${successCase.status} response did not include the documented JSON object`
  }
  if (successCase.body === 'optional-object' && data !== null && !isRecordLike(data)) {
    return `NetSuite HTTP ${successCase.status} response was neither empty nor a JSON object`
  }
  if (!successCase.validator || !isRecordLike(data)) return null

  switch (successCase.validator) {
    case 'collection-page':
      return validateCollectionPage(data, { label: 'collection page', requireHasMore: true })
    case 'suiteql-page':
      return validateCollectionPage(data, { label: 'SuiteQL page', requireHasMore: false })
    case 'record-action':
      return data.result === true
        ? null
        : 'NetSuite record-action success response did not include result: true'
    case 'metadata-catalog':
      return validateMetadataCatalog(data)
    case 'async-job':
      return validateRequiredProperties(
        data,
        {
          completed: 'boolean',
          id: 'string',
          progress: 'string',
          task: 'object',
          links: 'array',
        },
        'asynchronous job'
      )
    case 'async-task-collection':
      return validateRequiredProperties(
        data,
        { count: 'number', items: 'array', links: 'array' },
        'asynchronous task collection'
      )
    case 'async-task':
      return validateRequiredProperties(
        data,
        { completed: 'boolean', id: 'string', progress: 'string', links: 'array' },
        'asynchronous task'
      )
    case 'server-time':
      return typeof data.serverTime === 'string' && Boolean(data.serverTime.trim())
        ? null
        : 'NetSuite server-time response did not include serverTime'
    case 'governance-limits': {
      const requiredError = validateRequiredProperties(
        data,
        {
          accountConcurrencyLimit: 'number',
          accountUnallocatedConcurrencyLimit: 'number',
          integrationLimitType: 'string',
        },
        'governance-limits'
      )
      if (requiredError) return requiredError
      return ['integrationSpecific', 'accountLimit', 'internal'].includes(
        data.integrationLimitType as string
      )
        ? null
        : 'NetSuite governance-limits response included an unknown integrationLimitType'
    }
  }
}

function validateMetadataCatalog(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.items)) {
    return 'NetSuite metadata catalog response did not include an items array'
  }
  if (data.links !== undefined && !Array.isArray(data.links)) {
    return 'NetSuite metadata catalog response included invalid links'
  }
  for (const item of data.items) {
    if (!isRecordLike(item) || !isNonEmptyString(item.name)) {
      return 'NetSuite metadata catalog response included an invalid record type'
    }
    if (item.links !== undefined && !Array.isArray(item.links)) {
      return 'NetSuite metadata catalog response included invalid record-type links'
    }
  }
  return null
}

/**
 * Validates a documented NetSuite collection page.
 *
 * Oracle documents `hasMore` on record collections and SuiteAnalytics dataset
 * pages, but its SuiteQL reference lists only `links`, `count`, `offset`,
 * `totalResults`, and `items`. SuiteQL therefore validates `hasMore` only when
 * the account actually returns it, so a documented SuiteQL page is never
 * reported as a failed request.
 * @see https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156414087576.html
 * @see https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157909186990.html
 */
function validateCollectionPage(
  data: Record<string, unknown>,
  { label, requireHasMore }: { label: string; requireHasMore: boolean }
): string | null {
  const properties: Record<string, 'array' | 'boolean' | 'number' | 'object' | 'string'> = {
    links: 'array',
    items: 'array',
    count: 'number',
    offset: 'number',
    totalResults: 'number',
  }
  if (requireHasMore) properties.hasMore = 'boolean'

  const error = validateRequiredProperties(data, properties, label)
  if (error) return error
  if (!requireHasMore && data.hasMore !== undefined && typeof data.hasMore !== 'boolean') {
    return `NetSuite ${label} response did not include a valid hasMore`
  }
  for (const key of ['count', 'offset', 'totalResults'] as const) {
    const value = data[key]
    if (!Number.isInteger(value) || (value as number) < 0) {
      return `NetSuite ${label} response included an invalid ${key}`
    }
  }
  return null
}

function validateRequiredProperties(
  data: Record<string, unknown>,
  properties: Record<string, 'array' | 'boolean' | 'number' | 'object' | 'string'>,
  label: string
): string | null {
  for (const [key, type] of Object.entries(properties)) {
    const value = data[key]
    const valid =
      type === 'array'
        ? Array.isArray(value)
        : type === 'object'
          ? isRecordLike(value)
          : type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type
    if (!valid) return `NetSuite ${label} response did not include a valid ${key}`
  }
  return null
}

function expectsAsyncJob(request: NetSuiteRequest): boolean {
  return request.responseLocation === 'async-job'
}

function normalizeAuthParams(auth: NetSuiteAuthParams): NetSuiteAuthParams {
  if (!isRecordLike(auth)) throw new Error('NetSuite credentials are required')
  return {
    oauthCredential: requiredTrim(auth.oauthCredential, 'NetSuite credential'),
    accessToken: requiredTrim(auth.accessToken ?? '', 'NetSuite access token'),
    instanceUrl: requiredTrim(auth.instanceUrl ?? '', 'SuiteTalk URL'),
  }
}

function validateResponseLocation(
  headerValue: string | null,
  origin: string,
  mode?: NetSuiteRequest['responseLocation']
): { location?: string; jobId?: string } {
  if (!mode || !headerValue?.trim()) return {}
  const location = headerValue.trim()
  try {
    const parsed = new URL(location, origin)
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return {}
    }
    if (mode === 'resource' || mode === 'resource-optional') {
      return parsed.pathname.startsWith('/services/rest/record/v1/') ? { location } : {}
    }
    if (parsed.search) return {}
    const match = parsed.pathname.match(/^\/services\/rest\/async\/v1\/job\/([^/]+)$/)
    if (!match?.[1]) return {}
    const jobId = decodeURIComponent(match[1])
    if (!jobId || jobId.includes('/') || jobId.includes('?') || jobId.includes('#')) return {}
    return { location, jobId }
  } catch {
    return {}
  }
}

function isIdempotentJobReplay(request: NetSuiteRequest, status: number, data: unknown): boolean {
  if (status !== 400) return false
  const hasIdempotencyKey = Object.entries(request.headers ?? {}).some(
    ([name, value]) => name.toLowerCase() === 'x-netsuite-idempotency-key' && Boolean(value.trim())
  )
  if (!hasIdempotencyKey || !isRecordLike(data)) return false

  const errorDetails = data['o:errorDetails']
  return (
    Array.isArray(errorDetails) &&
    errorDetails.some(
      (detail) => isRecordLike(detail) && detail['o:errorCode'] === 'IDEMPOTENCY_ERROR'
    )
  )
}

function extractNetSuiteError(data: unknown, status: number, auth: NetSuiteAuthParams): string {
  if (isRecordLike(data)) {
    const errorDetails = data['o:errorDetails']
    if (Array.isArray(errorDetails)) {
      const summaries = errorDetails.flatMap((detail) => {
        if (!isRecordLike(detail)) return []
        const message = typeof detail.detail === 'string' ? detail.detail.trim() : ''
        const context = [
          ['code', detail['o:errorCode']],
          ['path', detail['o:errorPath']],
          ['URL path', detail['o:urlPath']],
          ['header', detail['o:errorHeader']],
          ['query parameter', detail['o:errorQueryParam']],
        ].flatMap(([label, value]) =>
          typeof value === 'string' && value.trim() ? [`${label}=${value.trim()}`] : []
        )
        if (!message && context.length === 0) return []
        return [`${message || 'NetSuite error'}${context.length ? ` [${context.join(', ')}]` : ''}`]
      })
      if (summaries.length > 0) {
        return `NetSuite request failed (${status}): ${sanitizeErrorText(summaries.join('; '), auth)}`
      }
    }
    for (const key of ['detail', 'title', 'error_description', 'message']) {
      if (typeof data[key] === 'string' && data[key].trim()) {
        const errorCode =
          typeof data['o:errorCode'] === 'string' && data['o:errorCode'].trim()
            ? ` [code=${data['o:errorCode'].trim()}]`
            : ''
        return `NetSuite request failed (${status}): ${sanitizeErrorText(`${data[key]}${errorCode}`, auth)}`
      }
    }
  }
  if (typeof data === 'string' && data.trim()) {
    return `NetSuite request failed (${status}): ${sanitizeErrorText(data, auth)}`
  }
  return `NetSuite request failed with HTTP ${status}`
}

function sanitizeErrorText(value: string, auth?: NetSuiteAuthParams): string {
  let sanitized = value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
  for (const credential of auth ? [auth.oauthCredential, auth.accessToken, auth.instanceUrl] : []) {
    if (typeof credential !== 'string') continue
    const secret = credential.trim()
    if (secret.length >= 3) sanitized = sanitized.split(secret).join('[REDACTED]')
  }
  return truncate(sanitized.replace(/\s+/g, ' ').trim(), 900) || 'Unknown error'
}
