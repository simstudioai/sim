import type { OciClient } from '@/lib/internal/oci/client.server'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import { ociNotificationsTopicSchema } from '@/lib/internal/oci-notifications/schema'

/** Management endpoints: https://docs.oracle.com/en-us/iaas/api/specs/index.json */
const controlPolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci-notifications',
  serviceName: 'notification',
  hostnameTemplate: 'regional-oci',
})
const dataPolicy = createOciDiscoveredEndpointPolicy({
  serviceId: 'oci-notifications',
  serviceName: 'notification',
  hostnameTemplate: 'regional-oci',
  responsePolicy: controlPolicy,
  source: { kind: 'json', path: ['apiEndpoint'] },
})

export interface PreparedOciNotificationsClient {
  client: OciClient
  control: OciPreparedEndpoint
}

export async function prepareOciNotificationsClient(
  client: OciClient
): Promise<PreparedOciNotificationsClient> {
  return { client, control: await client.prepareStaticEndpoint(controlPolicy) }
}

export async function discoverOciNotificationsTopic(
  prepared: PreparedOciNotificationsClient,
  topicId: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const response = await prepared.client.request({
    endpoint: prepared.control,
    method: 'GET',
    encodedPath: `/20181201/topics/${encodeURIComponent(topicId)}`,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
    retry: { kind: 'safe', maxAttempts: 2 },
    signal,
  })
  if (response.status !== 200) throw new OciClientError('invalid_endpoint')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    throw new OciClientError('invalid_endpoint')
  }
  const parsed = ociNotificationsTopicSchema.safeParse(value)
  if (!parsed.success || parsed.data.topicId !== topicId) {
    throw new OciClientError('invalid_endpoint')
  }
  /** Discovery retains the original response's same-client authenticated provenance. */
  const endpoint = await prepared.client.prepareDiscoveredEndpoint(dataPolicy, response)
  return { endpoint, topic: parsed.data }
}
