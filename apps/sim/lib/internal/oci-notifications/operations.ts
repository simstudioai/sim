import { z } from 'zod'
import type { OciAuthenticatedResponse, OciRequest } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  discoverOciNotificationsTopic,
  type PreparedOciNotificationsClient,
} from '@/lib/internal/oci-notifications/endpoints'
import {
  OCI_NOTIFICATIONS_MAX_PUBLISH_BYTES,
  type OciNotificationsInput,
  ociNotificationsPublishSchema,
  ociNotificationsSubscriptionSchema,
  ociNotificationsSubscriptionSummarySchema,
  ociNotificationsSubscriptionUpdateSchema,
  ociNotificationsTopicSchema,
} from '@/lib/internal/oci-notifications/schema'
import type { OciNotificationsOutput } from '@/tools/oci_notifications/types'

export class OciNotificationsOperationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly requestId?: string
  ) {
    super(message)
    this.name = 'OciNotificationsOperationError'
  }
}

function decode<T>(response: OciAuthenticatedResponse, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(new TextDecoder().decode(response.body)))
  } catch {
    throw new OciNotificationsOperationError(
      'OCI Notifications returned an invalid response',
      502,
      response.opcRequestId
    )
  }
}

function query(values: Record<string, string | number | boolean | undefined>): [string, string][] {
  return Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  )
}

/** Executes one management operation or page. Publishing never enables transport retries. */
export async function executeOciNotificationsOperation(
  input: OciNotificationsInput,
  prepared: PreparedOciNotificationsClient,
  signal?: AbortSignal
): Promise<OciNotificationsOutput> {
  signal?.throwIfAborted()
  const topicPath = 'topicId' in input ? `/topics/${encodeURIComponent(input.topicId)}` : '/topics'
  const subscriptionPath =
    'subscriptionId' in input
      ? `/subscriptions/${encodeURIComponent(input.subscriptionId)}`
      : '/subscriptions'
  let path = topicPath
  let method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'
  let body: unknown
  let queryPairs: [string, string][] = []
  let dataPlane = false
  let expectedStatus = 200
  const tags =
    'freeformTags' in input || 'definedTags' in input
      ? {
          freeformTags: 'freeformTags' in input ? input.freeformTags : undefined,
          definedTags: 'definedTags' in input ? input.definedTags : undefined,
        }
      : {}

  switch (input.operation) {
    case 'oci_notifications_list_topics':
      queryPairs = query({
        compartmentId: input.compartmentId,
        id: input.id,
        name: input.name,
        lifecycleState: input.lifecycleState,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        limit: input.limit,
        page: input.page,
      })
      break
    case 'oci_notifications_get_topic':
      break
    case 'oci_notifications_create_topic':
      method = 'POST'
      body = {
        compartmentId: input.compartmentId,
        name: input.name,
        description: input.description,
        ...tags,
      }
      break
    case 'oci_notifications_update_topic':
      method = 'PUT'
      body = { description: input.description, ...tags }
      break
    case 'oci_notifications_delete_topic':
      method = 'DELETE'
      expectedStatus = 204
      break
    case 'oci_notifications_change_topic_compartment':
      method = 'POST'
      path = `${topicPath}/actions/changeCompartment`
      body = { compartmentId: input.destinationCompartmentId }
      expectedStatus = 204
      break
    case 'oci_notifications_add_topic_lock':
    case 'oci_notifications_remove_topic_lock':
      method = 'POST'
      path = `${topicPath}/actions/${input.operation === 'oci_notifications_add_topic_lock' ? 'addLock' : 'removeLock'}`
      body = input.lock
      break
    case 'oci_notifications_list_subscriptions':
      dataPlane = true
      path = subscriptionPath
      queryPairs = query({
        compartmentId: input.compartmentId,
        topicId: input.topicId,
        limit: input.limit,
        page: input.page,
      })
      break
    case 'oci_notifications_get_subscription':
      dataPlane = true
      path = subscriptionPath
      break
    case 'oci_notifications_create_subscription':
      dataPlane = true
      method = 'POST'
      path = subscriptionPath
      body = {
        topicId: input.topicId,
        protocol: input.protocol,
        endpoint: input.endpoint,
        metadata: input.metadata,
        ...tags,
      }
      break
    case 'oci_notifications_update_subscription':
      dataPlane = true
      method = 'PUT'
      path = subscriptionPath
      body = { deliveryPolicy: input.deliveryPolicy, ...tags }
      break
    case 'oci_notifications_delete_subscription':
      dataPlane = true
      method = 'DELETE'
      path = subscriptionPath
      expectedStatus = 204
      break
    case 'oci_notifications_change_subscription_compartment':
      dataPlane = true
      method = 'POST'
      path = `${subscriptionPath}/actions/changeCompartment`
      body = { compartmentId: input.destinationCompartmentId }
      expectedStatus = 204
      break
    case 'oci_notifications_resend_subscription_confirmation':
      dataPlane = true
      method = 'POST'
      path = `${subscriptionPath}/resendConfirmation`
      break
    case 'oci_notifications_publish_message':
      dataPlane = true
      method = 'POST'
      path = `${topicPath}/messages`
      body = { body: input.body, title: input.title }
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > OCI_NOTIFICATIONS_MAX_PUBLISH_BYTES) {
        throw new OciNotificationsOperationError(
          'Publish request exceeds the Sim limit of 64,000 UTF-8 bytes including JSON encoding',
          413
        )
      }
      break
  }

  if ('isLockOverride' in input) {
    queryPairs.push(...query({ isLockOverride: input.isLockOverride }))
  }
  let endpoint = prepared.control
  if (dataPlane && 'topicId' in input) {
    const discovered = await discoverOciNotificationsTopic(prepared, input.topicId, signal)
    endpoint = discovered.endpoint
    if (input.operation === 'oci_notifications_create_subscription') {
      body = {
        topicId: input.topicId,
        compartmentId: discovered.topic.compartmentId,
        protocol: input.protocol,
        endpoint: input.endpoint,
        metadata: input.metadata,
        ...tags,
      }
    }
  }
  signal?.throwIfAborted()
  const base = {
    endpoint,
    encodedPath: `/20181201${path}`,
    queryPairs,
    headers: 'ifMatch' in input && input.ifMatch ? { 'if-match': input.ifMatch } : undefined,
    timeoutMs: 30_000,
    maxResponseBytes: 1024 * 1024,
    responseHeaders: ['opc-next-page'],
    signal,
  }
  let request: OciRequest
  if (method === 'POST' || method === 'PUT') {
    request = {
      ...base,
      method,
      body: body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body)),
      contentType: 'application/json',
      ...('retryToken' in input && input.retryToken
        ? { retry: { kind: 'tokenized' as const, maxAttempts: 2, retryToken: input.retryToken } }
        : {}),
    }
  } else if (method === 'DELETE') {
    request = { ...base, method }
  } else {
    request = { ...base, method, retry: { kind: 'safe', maxAttempts: 2 } }
  }

  try {
    const response = await prepared.client.request(request)
    signal?.throwIfAborted()
    if (response.status !== expectedStatus) {
      throw new OciNotificationsOperationError(
        'OCI Notifications returned an unexpected response status',
        502,
        response.opcRequestId
      )
    }
    const output: OciNotificationsOutput = {
      status: response.status,
      requestId: response.opcRequestId,
      etag: response.headers.etag,
      nextPage: response.headers['opc-next-page'],
    }
    if (expectedStatus === 204) return output
    switch (input.operation) {
      case 'oci_notifications_list_topics':
        return { ...output, topics: decode(response, z.array(ociNotificationsTopicSchema)) }
      case 'oci_notifications_list_subscriptions':
        return {
          ...output,
          subscriptions: decode(response, z.array(ociNotificationsSubscriptionSummarySchema)),
        }
      case 'oci_notifications_create_subscription':
      case 'oci_notifications_get_subscription':
      case 'oci_notifications_resend_subscription_confirmation':
        return { ...output, subscription: decode(response, ociNotificationsSubscriptionSchema) }
      case 'oci_notifications_update_subscription':
        return {
          ...output,
          subscriptionUpdate: decode(response, ociNotificationsSubscriptionUpdateSchema),
        }
      case 'oci_notifications_publish_message':
        return { ...output, ...decode(response, ociNotificationsPublishSchema) }
      default:
        return { ...output, topic: decode(response, ociNotificationsTopicSchema) }
    }
  } catch (error) {
    signal?.throwIfAborted()
    const ambiguous =
      error instanceof OciNotificationsOperationError ||
      (error instanceof OciClientError &&
        (error.code === 'deadline_exceeded' ||
          error.code === 'response_too_large' ||
          (error.code === 'request_failed' && (!error.status || error.status >= 500))))
    if (input.operation === 'oci_notifications_publish_message' && ambiguous) {
      throw new OciNotificationsOperationError(
        'Publication acceptance is unknown. Publishing was attempted once; retrying the block may send a duplicate.',
        error instanceof OciClientError && error.code === 'deadline_exceeded' ? 504 : 502,
        error instanceof OciClientError
          ? error.opcRequestId
          : error instanceof OciNotificationsOperationError
            ? error.requestId
            : undefined
      )
    }
    throw error
  }
}
