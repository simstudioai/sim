import { z } from 'zod'
import type { OciAuthenticatedResponse, OciRequest } from '@/lib/internal/oci/client.server'
import {
  discoverOciQueueEndpoint,
  type PreparedOciQueueClient,
} from '@/lib/internal/oci-queue/endpoints'
import {
  OCI_QUEUE_MAX_MESSAGE_BYTES,
  OCI_QUEUE_MAX_PUT_BYTES,
  type OciQueueInput,
  ociQueueBatchEntrySchema,
  ociQueuePublishedMessageSchema,
  ociQueueReceivedMessageSchema,
  ociQueueSchema,
  ociQueueStatsSchema,
  ociQueueSummarySchema,
  ociQueueUpdatedMessageSchema,
  ociQueueWorkRequestSchema,
} from '@/lib/internal/oci-queue/schema'
import type {
  OciQueueBatchResult,
  OciQueueConfiguration,
  OciQueueOutput,
} from '@/tools/oci_queue/types'

export class OciQueueOperationError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message)
    this.name = 'OciQueueOperationError'
  }
}

function invalidResponse(): never {
  throw new OciQueueOperationError('OCI Queue returned an invalid response')
}

function decode<T>(
  response: OciAuthenticatedResponse,
  schema: z.ZodType<T>,
  preserveMessageIds = false
): T {
  try {
    /**
     * The reviver source retains Oracle's int64 message IDs before Number rounds them.
     * Runtimes without source support may only accept IDs representable without loss.
     */
    const value = JSON.parse(
      new TextDecoder().decode(response.body),
      (key, item: unknown, context?: { source?: string }) => {
        if (!preserveMessageIds || key !== 'id' || typeof item !== 'number') return item
        if (context?.source && /^-?\d+$/.test(context.source)) return context.source
        if (Number.isSafeInteger(item)) return String(item)
        return invalidResponse()
      }
    )
    const parsed = schema.safeParse(value)
    if (!parsed.success) return invalidResponse()
    return parsed.data
  } catch {
    return invalidResponse()
  }
}

function query(values: Record<string, string | number | undefined>): [string, string][] {
  return Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  )
}

function configuration(input: OciQueueConfiguration) {
  return {
    displayName: input.displayName,
    visibilityInSeconds: input.visibilityInSeconds,
    timeoutInSeconds: input.timeoutInSeconds,
    deadLetterQueueDeliveryCount: input.deadLetterQueueDeliveryCount,
    channelConsumptionLimit: input.channelConsumptionLimit,
    customEncryptionKeyId: input.customEncryptionKeyId,
    freeformTags: input.freeformTags,
    definedTags: input.definedTags,
  }
}

function batchResult(
  response: OciAuthenticatedResponse,
  count: number,
  update: boolean
): OciQueueBatchResult {
  const result = decode(
    response,
    z.object({
      clientFailures: z.number().int().min(0).max(count),
      serverFailures: z.number().int().min(0).max(count),
      entries: z.array(ociQueueBatchEntrySchema).length(count),
    }),
    update
  )
  const entries = result.entries.map((entry, index) => {
    const failure = entry.errorCode !== undefined || entry.errorMessage !== undefined
    if (failure) {
      if (entry.errorCode === undefined || entry.errorMessage === undefined) invalidResponse()
      if (entry.id !== undefined || entry.visibleAfter !== undefined) invalidResponse()
    } else if (update && (entry.id === undefined || entry.visibleAfter === undefined)) {
      invalidResponse()
    }
    return { ...entry, index, success: !failure }
  })
  if (
    entries.filter((entry) => !entry.success).length !==
    result.clientFailures + result.serverFailures
  ) {
    invalidResponse()
  }
  return {
    ...result,
    entries,
    allSucceeded: result.clientFailures === 0 && result.serverFailures === 0,
  }
}

/** One API page or message batch. Receiving is a state change, even though Oracle uses GET. */
export async function executeOciQueueOperation(
  input: OciQueueInput,
  prepared: PreparedOciQueueClient,
  signal?: AbortSignal
): Promise<OciQueueOutput> {
  signal?.throwIfAborted()
  const queuePath = 'queueId' in input ? `/queues/${encodeURIComponent(input.queueId)}` : '/queues'
  const workPath =
    'workRequestId' in input && input.workRequestId
      ? `/workRequests/${encodeURIComponent(input.workRequestId)}`
      : '/workRequests'
  let path = queuePath
  let method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'
  let body: unknown
  let queryPairs: [string, string][] = []
  let dataPlane = false
  let safe = false
  let timeoutMs = 30_000
  let expectedStatus = 200
  const paging =
    'limit' in input || 'page' in input
      ? {
          limit: 'limit' in input ? input.limit : undefined,
          page: 'page' in input ? input.page : undefined,
        }
      : {}
  const consumerGroupId = 'consumerGroupId' in input ? input.consumerGroupId : undefined

  switch (input.operation) {
    case 'oci_queue_list_queues':
      safe = true
      queryPairs = query({
        ...paging,
        compartmentId: input.compartmentId,
        displayName: input.displayName,
        id: input.id,
        lifecycleState: input.lifecycleState,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      })
      break
    case 'oci_queue_get_queue':
      safe = true
      break
    case 'oci_queue_create_queue':
      method = 'POST'
      expectedStatus = 202
      body = {
        ...configuration(input),
        compartmentId: input.compartmentId,
        retentionInSeconds: input.retentionInSeconds,
      }
      break
    case 'oci_queue_update_queue':
      method = 'PUT'
      expectedStatus = 202
      body = configuration(input)
      break
    case 'oci_queue_delete_queue':
      method = 'DELETE'
      expectedStatus = 202
      break
    case 'oci_queue_change_queue_compartment':
      method = 'POST'
      expectedStatus = 202
      path += '/actions/changeCompartment'
      body = { compartmentId: input.destinationCompartmentId }
      break
    case 'oci_queue_purge_queue':
      method = 'POST'
      expectedStatus = 202
      path += '/actions/purge'
      body = { purgeType: input.purgeType, channelIds: input.channelIds, consumerGroupId }
      break
    case 'oci_queue_put_messages':
      method = 'POST'
      dataPlane = true
      path += '/messages'
      body = { messages: input.messages }
      for (const message of input.messages) {
        if (Buffer.byteLength(message.content, 'utf8') > OCI_QUEUE_MAX_MESSAGE_BYTES) {
          throw new OciQueueOperationError('Message content exceeds 256 KiB', 400)
        }
      }
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > OCI_QUEUE_MAX_PUT_BYTES) {
        throw new OciQueueOperationError('Serialized message batch exceeds 512 KiB', 400)
      }
      break
    case 'oci_queue_get_messages':
      dataPlane = true
      path += '/messages'
      /**
       * Queue's configured polling default is unknown without reading configuration; 30 is its maximum.
       */
      timeoutMs = ((input.timeoutInSeconds ?? 30) + 15) * 1000
      queryPairs = query({
        limit: input.limit,
        timeoutInSeconds: input.timeoutInSeconds,
        visibilityInSeconds: input.visibilityInSeconds,
        channelFilter: input.channelFilter,
        consumerGroupId,
      })
      break
    case 'oci_queue_delete_message':
    case 'oci_queue_update_message':
      dataPlane = true
      path += `/messages/${encodeURIComponent(input.messageReceipt)}`
      queryPairs = query({ consumerGroupId })
      if (input.operation === 'oci_queue_delete_message') {
        method = 'DELETE'
        expectedStatus = 204
      } else {
        method = 'PUT'
        body = { visibilityInSeconds: input.visibilityInSeconds }
      }
      break
    case 'oci_queue_delete_messages':
    case 'oci_queue_update_messages':
      dataPlane = true
      method = 'POST'
      path +=
        input.operation === 'oci_queue_delete_messages'
          ? '/messages/actions/deleteMessages'
          : '/messages/actions/updateMessages'
      queryPairs = query({ consumerGroupId })
      body = { entries: input.entries }
      break
    case 'oci_queue_get_stats':
      dataPlane = true
      safe = true
      path += '/stats'
      queryPairs = query({ channelId: input.channelId, consumerGroupId })
      break
    case 'oci_queue_list_channels':
      dataPlane = true
      safe = true
      path += '/channels'
      queryPairs = query({ ...paging, channelFilter: input.channelFilter, consumerGroupId })
      break
    case 'oci_queue_list_work_requests':
      safe = true
      path = '/workRequests'
      queryPairs = query({
        ...paging,
        compartmentId: input.compartmentId,
        workRequestId: input.workRequestId,
      })
      break
    case 'oci_queue_get_work_request':
      safe = true
      path = workPath
      break
    case 'oci_queue_list_work_request_errors':
    case 'oci_queue_list_work_request_logs':
      safe = true
      path = `${workPath}/${input.operation === 'oci_queue_list_work_request_errors' ? 'errors' : 'logs'}`
      queryPairs = query(paging)
      break
  }

  const endpoint =
    dataPlane && 'queueId' in input
      ? await discoverOciQueueEndpoint(prepared, input.queueId, signal)
      : prepared.control
  signal?.throwIfAborted()
  const base = {
    endpoint,
    encodedPath: `/20210201${path}`,
    queryPairs,
    headers: 'ifMatch' in input && input.ifMatch ? { 'if-match': input.ifMatch } : undefined,
    timeoutMs,
    maxResponseBytes: 4 * 1024 * 1024,
    responseHeaders: ['opc-next-page', 'opc-work-request-id', 'retry-after'],
    signal,
  }
  let request: OciRequest
  if (method === 'POST' || method === 'PUT') {
    request = {
      ...base,
      method,
      body: new TextEncoder().encode(JSON.stringify(body)),
      contentType: 'application/json',
      /**
       * The foundation owns retry-token headers. Only explicitly tokenized creation is retried.
       */
      ...(input.operation === 'oci_queue_create_queue' && input.retryToken
        ? { retry: { kind: 'tokenized' as const, maxAttempts: 2, retryToken: input.retryToken } }
        : {}),
    }
  } else if (method === 'DELETE') {
    request = { ...base, method }
  } else {
    request = {
      ...base,
      method,
      ...(safe ? { retry: { kind: 'safe' as const, maxAttempts: 2 } } : {}),
    }
  }
  const response = await prepared.client.request(request)
  signal?.throwIfAborted()
  if (response.status !== expectedStatus) invalidResponse()
  const output: OciQueueOutput = {
    status: response.status,
    requestId: response.opcRequestId,
    etag: response.headers.etag,
    nextPage: response.headers['opc-next-page'],
  }
  if (expectedStatus === 202) {
    const workRequestId = response.headers['opc-work-request-id']
    if (!workRequestId) invalidResponse()
    return { ...output, workRequestId }
  }
  if (expectedStatus === 204) return output

  switch (input.operation) {
    case 'oci_queue_list_queues':
      return {
        ...output,
        queues: decode(response, z.object({ items: z.array(ociQueueSummarySchema) })).items,
      }
    case 'oci_queue_get_queue': {
      const queue = decode(response, ociQueueSchema)
      return {
        ...output,
        queue: { ...queue, capabilities: queue.capabilities?.map((capability) => capability.type) },
      }
    }
    case 'oci_queue_put_messages':
      return {
        ...output,
        messages: decode(
          response,
          z.object({ messages: z.array(ociQueuePublishedMessageSchema) }),
          true
        ).messages,
      }
    case 'oci_queue_get_messages':
      return {
        ...output,
        messages: decode(
          response,
          z.object({ messages: z.array(ociQueueReceivedMessageSchema) }),
          true
        ).messages,
      }
    case 'oci_queue_update_message':
      return { ...output, updatedMessage: decode(response, ociQueueUpdatedMessageSchema, true) }
    case 'oci_queue_delete_messages':
    case 'oci_queue_update_messages':
      return {
        ...output,
        ...batchResult(
          response,
          input.entries.length,
          input.operation === 'oci_queue_update_messages'
        ),
      }
    case 'oci_queue_get_stats':
      return { ...output, stats: decode(response, ociQueueStatsSchema) }
    case 'oci_queue_list_channels':
      return {
        ...output,
        channels: decode(response, z.object({ items: z.array(z.string()) })).items,
      }
    case 'oci_queue_list_work_requests':
      return {
        ...output,
        workRequests: decode(response, z.object({ items: z.array(ociQueueWorkRequestSchema) }))
          .items,
      }
    case 'oci_queue_get_work_request': {
      const retryAfter = response.headers['retry-after']
      return {
        ...output,
        workRequest: decode(response, ociQueueWorkRequestSchema),
        ...(retryAfter && /^\d+$/.test(retryAfter) ? { retryAfter: Number(retryAfter) } : {}),
      }
    }
    case 'oci_queue_list_work_request_errors':
      return {
        ...output,
        errors: decode(
          response,
          z.object({
            items: z.array(
              z.object({ code: z.string(), message: z.string(), timestamp: z.string() })
            ),
          })
        ).items,
      }
    case 'oci_queue_list_work_request_logs':
      return {
        ...output,
        logs: decode(
          response,
          z.object({ items: z.array(z.object({ message: z.string(), timestamp: z.string() })) })
        ).items,
      }
    default:
      return invalidResponse()
  }
}
