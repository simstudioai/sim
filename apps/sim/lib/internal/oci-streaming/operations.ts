import { z } from 'zod'
import type {
  OciAuthenticatedResponse,
  OciClient,
  OciRequest,
} from '@/lib/internal/oci/client.server'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'
import {
  cursorResponseSchema,
  groupSchema,
  messageSchema,
  type OciStreamingInput,
  publishResponseSchema,
  streamPoolSchema,
  streamPoolSummarySchema,
  streamSchema,
  streamSummarySchema,
  workRequestErrorSchema,
  workRequestLogSchema,
  workRequestSchema,
} from '@/lib/internal/oci-streaming/schema'

export const OCI_STREAMING_SERVICE_ID = 'oci-streaming'
export const OCI_STREAMING_ADMIN_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: OCI_STREAMING_SERVICE_ID,
  serviceName: 'streaming',
  hostnameTemplate: 'regional-oci',
})
export const OCI_STREAMING_MESSAGES_ENDPOINT = createOciDiscoveredEndpointPolicy({
  serviceId: OCI_STREAMING_SERVICE_ID,
  serviceName: 'streaming',
  hostnameTemplate: 'regional-oci',
  responsePolicy: OCI_STREAMING_ADMIN_ENDPOINT,
  source: { kind: 'json', path: ['messagesEndpoint'] },
})

const ADMIN_RESPONSE_BYTES = 1024 * 1024
const MESSAGE_RESPONSE_BYTES = 8 * 1024 * 1024
const PUBLISH_DECODED_BYTES = 1024 * 1024
const PUBLISH_BODY_BYTES = 2 * 1024 * 1024
const PREFIX = '/20180418'

export interface OciStreamingSession {
  client: OciClient
  endpoint: OciPreparedEndpoint
}

export interface OciStreamingBudget {
  signal: AbortSignal
  deadline: number
}

/** Bounds even preparation/authorization waits that do not accept an AbortSignal. */
export function awaitOciStreaming<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
    if (signal.aborted) aborted()
  })
}

export async function withOciStreamingBudget<T>(
  work: (budget: OciStreamingBudget) => Promise<T>,
  signal?: AbortSignal,
  deadline = Date.now() + 60_000
): Promise<T> {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timeout = setTimeout(
    () => controller.abort(new DOMException('OCI Streaming execution timed out', 'TimeoutError')),
    Math.max(0, deadline - Date.now())
  )
  try {
    combined.throwIfAborted()
    if (Date.now() >= deadline) throw new Error('OCI Streaming execution timed out')
    return await awaitOciStreaming(work({ signal: combined, deadline }), combined)
  } finally {
    clearTimeout(timeout)
  }
}

/** Only message/group contracts contain offsets; administrative tag values are never rewritten. */
export function parseOciStreamingJson(
  body: Uint8Array,
  offsetKey?: 'offset' | 'committedOffset'
): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  return JSON.parse(text, (key: string, value: unknown, context?: { source: string }) => {
    if (offsetKey && key === offsetKey && value !== null) {
      if (
        typeof value !== 'number' ||
        !context?.source ||
        !/^-?(0|[1-9][0-9]*)$/.test(context.source)
      ) {
        throw new Error(
          'OCI Streaming returned an invalid integer offset or JSON source access is unavailable'
        )
      }
      return context.source
    }
    return value
  })
}

/** JSON.rawJSON preserves the numeric wire token without passing an int64 through Number. */
export function serializeOciStreamingJson(body: Record<string, unknown>): Uint8Array {
  const runtimeJson = JSON as typeof JSON & { rawJSON?: (value: string) => unknown }
  const value = { ...body }
  if (typeof value.offset === 'string') {
    if (!runtimeJson.rawJSON)
      throw new Error('OCI Streaming requires JSON.rawJSON for exact offsets')
    value.offset = runtimeJson.rawJSON(value.offset)
  }
  return new TextEncoder().encode(JSON.stringify(value))
}

function base64Bytes(value: string): Buffer {
  if (value.length % 4 !== 0) {
    throw new Error('Messages must use canonical padded base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value)
    throw new Error('Messages must use canonical padded base64')
  return bytes
}

export function buildOciStreamingPublishBody(
  input: Extract<OciStreamingInput, { operation: 'put_messages' }>
): Uint8Array {
  let total = 0
  const messages = input.messages.map((message) => {
    const key =
      message.key == null
        ? null
        : input.encoding === 'base64'
          ? base64Bytes(message.key)
          : Buffer.from(message.key, 'utf8')
    const value =
      input.encoding === 'base64' ? base64Bytes(message.value) : Buffer.from(message.value, 'utf8')
    if ((key?.length ?? 0) > 256) throw new Error('Message keys cannot exceed 256 decoded bytes')
    if (value.length < 1 || value.length > PUBLISH_DECODED_BYTES) {
      throw new Error('Message values must contain 1 to 1,048,576 decoded bytes')
    }
    total += (key?.length ?? 0) + value.length
    if (total > PUBLISH_DECODED_BYTES)
      throw new Error('Publish batches cannot exceed 1 MiB of decoded keys and values')
    return { key: key?.toString('base64') ?? null, value: value.toString('base64') }
  })
  const body = serializeOciStreamingJson({ messages })
  if (body.byteLength > PUBLISH_BODY_BYTES) throw new Error('Publish bodies cannot exceed 2 MiB')
  return body
}

interface StreamingRequest {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | undefined>
  body?: Record<string, unknown> | Uint8Array
  message?: boolean
}

function buildRequest(input: OciStreamingInput): StreamingRequest {
  const streamPath =
    'streamId' in input ? `/streams/${encodeURIComponent(input.streamId)}` : '/streams'
  const poolPath =
    'streamPoolId' in input && input.streamPoolId
      ? `/streampools/${encodeURIComponent(input.streamPoolId)}`
      : '/streampools'
  const workPath =
    'workRequestId' in input && input.workRequestId
      ? `/workRequests/${encodeURIComponent(input.workRequestId)}`
      : '/workRequests'
  switch (input.operation) {
    case 'list_streams':
      return {
        path: '/streams',
        method: 'GET',
        query: {
          compartmentId: input.compartmentId,
          streamPoolId: input.streamPoolId,
          id: input.id,
          name: input.name,
          lifecycleState: input.lifecycleState,
          limit: input.limit,
          page: input.page,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        },
      }
    case 'list_stream_pools':
      return {
        path: '/streampools',
        method: 'GET',
        query: {
          compartmentId: input.compartmentId,
          id: input.id,
          name: input.name,
          lifecycleState: input.lifecycleState,
          limit: input.limit,
          page: input.page,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        },
      }
    case 'get_stream':
      return { path: streamPath, method: 'GET' }
    case 'get_stream_pool':
      return { path: poolPath, method: 'GET' }
    case 'create_stream':
      return {
        path: '/streams',
        method: 'POST',
        body: {
          name: input.name,
          partitions: input.partitions,
          compartmentId: input.compartmentId,
          streamPoolId: input.streamPoolId,
          retentionInHours: input.retentionInHours,
          freeformTags: input.freeformTags,
          definedTags: input.definedTags,
        },
      }
    case 'update_stream':
      return {
        path: streamPath,
        method: 'PUT',
        body: {
          streamPoolId: input.streamPoolId,
          freeformTags: input.freeformTags,
          definedTags: input.definedTags,
        },
      }
    case 'create_stream_pool':
      return {
        path: '/streampools',
        method: 'POST',
        body: {
          name: input.name,
          compartmentId: input.compartmentId,
          freeformTags: input.freeformTags,
          definedTags: input.definedTags,
          customEncryptionKeyDetails: input.customEncryptionKeyDetails,
          kafkaSettings: input.kafkaSettings,
        },
      }
    case 'update_stream_pool':
      return {
        path: poolPath,
        method: 'PUT',
        body: {
          name: input.name,
          freeformTags: input.freeformTags,
          definedTags: input.definedTags,
          customEncryptionKeyDetails: input.customEncryptionKeyDetails,
          kafkaSettings: input.kafkaSettings,
        },
      }
    case 'delete_stream':
      return { path: streamPath, method: 'DELETE' }
    case 'delete_stream_pool':
      return { path: poolPath, method: 'DELETE' }
    case 'change_stream_compartment':
      return {
        path: `${streamPath}/actions/changeCompartment`,
        method: 'POST',
        body: { compartmentId: input.compartmentId },
      }
    case 'change_stream_pool_compartment':
      return {
        path: `${poolPath}/actions/changeCompartment`,
        method: 'POST',
        body: { compartmentId: input.compartmentId },
      }
    case 'put_messages':
      return {
        path: `${streamPath}/messages`,
        method: 'POST',
        body: buildOciStreamingPublishBody(input),
        message: true,
      }
    case 'create_cursor':
      return {
        path: `${streamPath}/cursors`,
        method: 'POST',
        body: {
          partition: input.partition,
          type: input.type,
          offset: input.offset,
          time: input.time,
        },
        message: true,
      }
    case 'create_group_cursor':
      return {
        path: `${streamPath}/groupCursors`,
        method: 'POST',
        body: {
          groupName: input.groupName,
          type: input.type,
          time: input.time,
          instanceName: input.instanceName,
          timeoutInMs: input.timeoutInMs,
          commitOnGet: input.commitOnGet,
        },
        message: true,
      }
    case 'get_messages':
      return {
        path: `${streamPath}/messages`,
        method: 'GET',
        query: { cursor: input.cursor, limit: input.limit },
        message: true,
      }
    case 'get_group':
      return {
        path: `${streamPath}/groups/${encodeURIComponent(input.groupName)}`,
        method: 'GET',
        message: true,
      }
    case 'update_group':
      return {
        path: `${streamPath}/groups/${encodeURIComponent(input.groupName)}`,
        method: 'PUT',
        body: { type: input.type, time: input.time },
        message: true,
      }
    case 'consumer_commit':
      return {
        path: `${streamPath}/commit`,
        method: 'POST',
        query: { cursor: input.cursor },
        body: new Uint8Array(0),
        message: true,
      }
    case 'consumer_heartbeat':
      return {
        path: `${streamPath}/heartbeat`,
        method: 'POST',
        query: { cursor: input.cursor },
        body: new Uint8Array(0),
        message: true,
      }
    case 'list_work_requests':
      return {
        path: '/workRequests',
        method: 'GET',
        query: {
          compartmentId: input.compartmentId,
          workRequestId: input.workRequestId,
          resourceId: input.resourceId,
          limit: input.limit,
          page: input.page,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
        },
      }
    case 'get_work_request':
      return { path: workPath, method: 'GET' }
    case 'list_work_request_errors':
      return {
        path: `${workPath}/errors`,
        method: 'GET',
        query: { limit: input.limit, page: input.page },
      }
    case 'list_work_request_logs':
      return {
        path: `${workPath}/logs`,
        method: 'GET',
        query: { limit: input.limit, page: input.page },
      }
  }
}

function projectResponse(
  input: OciStreamingInput,
  response: OciAuthenticatedResponse
): Record<string, unknown> {
  const empty =
    input.operation === 'update_group' ||
    input.operation.startsWith('delete_') ||
    input.operation.startsWith('change_')
  const expectedStatus = empty && input.operation !== 'update_group' ? 204 : 200
  if (response.status !== expectedStatus)
    throw new Error('OCI Streaming returned an unexpected success status')
  if (empty) {
    if (response.body.byteLength !== 0)
      throw new Error('OCI Streaming returned an unexpected response body')
    return {}
  }
  const offsetKey =
    input.operation === 'get_group'
      ? 'committedOffset'
      : input.operation === 'get_messages' || input.operation === 'put_messages'
        ? 'offset'
        : undefined
  const data = parseOciStreamingJson(response.body, offsetKey)
  const nextPage = response.headers['opc-next-page'] ?? null
  switch (input.operation) {
    case 'list_streams':
      return { streams: z.array(streamSummarySchema).parse(data), nextPage }
    case 'get_stream':
    case 'create_stream':
    case 'update_stream':
      return { stream: streamSchema.parse(data) }
    case 'list_stream_pools':
      return { streamPools: z.array(streamPoolSummarySchema).parse(data), nextPage }
    case 'get_stream_pool':
    case 'create_stream_pool':
    case 'update_stream_pool':
      return { streamPool: streamPoolSchema.parse(data) }
    case 'get_messages': {
      const nextCursor = response.headers['opc-next-cursor']
      if (!nextCursor) throw new Error('OCI Streaming did not return the next message cursor')
      return { messages: z.array(messageSchema).parse(data), nextCursor }
    }
    case 'get_group':
      return { group: groupSchema.parse(data) }
    case 'put_messages': {
      const result = publishResponseSchema.parse(data)
      if (
        result.entries.length !== input.messages.length ||
        result.failures !== result.entries.filter((entry) => Boolean(entry.error)).length
      ) {
        throw new Error(
          'OCI Streaming returned inconsistent publish results; delivery may have occurred'
        )
      }
      for (const entry of result.entries) {
        if (
          !entry.error &&
          (entry.offset == null || entry.partition == null || entry.timestamp == null)
        ) {
          throw new Error(
            'OCI Streaming omitted a successful publish result; delivery may have occurred'
          )
        }
      }
      return { ...result, allSucceeded: result.failures === 0 }
    }
    case 'create_cursor':
    case 'create_group_cursor':
    case 'consumer_commit':
    case 'consumer_heartbeat':
      return { cursor: cursorResponseSchema.parse(data).value }
    case 'list_work_requests':
      return {
        workRequests: z.object({ items: z.array(workRequestSchema) }).parse(data).items,
        nextPage,
      }
    case 'get_work_request':
      return { workRequest: workRequestSchema.parse(data) }
    case 'list_work_request_errors':
      return {
        errors: z.object({ items: z.array(workRequestErrorSchema) }).parse(data).items,
        nextPage,
      }
    case 'list_work_request_logs':
      return {
        logs: z.object({ items: z.array(workRequestLogSchema) }).parse(data).items,
        nextPage,
      }
    default:
      return {}
  }
}

/** Executes exactly one operation; message discovery is authenticated on the same client. */
export async function executeOciStreamingOperation(
  input: OciStreamingInput,
  session: OciStreamingSession,
  budget: OciStreamingBudget
): Promise<{ success: true; output: Record<string, unknown> }> {
  const request = buildRequest(input)
  const { client } = session
  let endpoint = session.endpoint
  const requestBudget = () => {
    budget.signal.throwIfAborted()
    const remaining = budget.deadline - Date.now()
    if (remaining <= 0) throw new Error('OCI Streaming execution timed out')
    return { signal: budget.signal, timeoutMs: Math.min(30_000, remaining) }
  }
  if (request.message && 'streamId' in input) {
    const discovery = await client.request({
      endpoint,
      encodedPath: `${PREFIX}/streams/${encodeURIComponent(input.streamId)}`,
      method: 'GET',
      maxResponseBytes: ADMIN_RESPONSE_BYTES,
      ...requestBudget(),
    })
    budget.signal.throwIfAborted()
    endpoint = await awaitOciStreaming(
      client.prepareDiscoveredEndpoint(OCI_STREAMING_MESSAGES_ENDPOINT, discovery),
      budget.signal
    )
  }
  const headers: Record<string, string> = {}
  if (input.requestId) headers['opc-request-id'] = input.requestId
  if ('ifMatch' in input && input.ifMatch) headers['if-match'] = input.ifMatch
  const queryPairs: [string, string][] = []
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) queryPairs.push([key, String(value)])
  }
  const common = {
    endpoint,
    encodedPath: `${PREFIX}${request.path}`,
    queryPairs,
    headers,
    responseHeaders: ['opc-next-page', 'opc-next-cursor', 'etag', 'opc-work-request-id'],
    maxResponseBytes: request.message ? MESSAGE_RESPONSE_BYTES : ADMIN_RESPONSE_BYTES,
    ...requestBudget(),
  }
  let wire: OciRequest
  if (request.method === 'GET') {
    wire = {
      ...common,
      method: 'GET',
      ...(!request.message ? { retry: { kind: 'safe' as const, maxAttempts: 2 } } : {}),
    }
  } else if (request.method === 'DELETE') {
    wire = { ...common, method: 'DELETE' }
  } else {
    wire = {
      ...common,
      method: request.method,
      contentType: 'application/json',
      body:
        request.body instanceof Uint8Array
          ? request.body
          : serializeOciStreamingJson(request.body ?? {}),
      ...(input.operation === 'create_stream_pool' && input.retryToken
        ? { retry: { kind: 'tokenized' as const, maxAttempts: 2, retryToken: input.retryToken } }
        : {}),
    }
  }
  const response = await client.request(wire)
  budget.signal.throwIfAborted()
  return {
    success: true,
    output: {
      status: response.status,
      requestId: response.opcRequestId ?? null,
      etag: response.headers.etag ?? null,
      workRequestId: response.headers['opc-work-request-id'] ?? null,
      ...projectResponse(input, response),
    },
  }
}
