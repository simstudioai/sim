import type { OciClient } from '@/lib/internal/oci/client.server'
import {
  createOciDiscoveredEndpointPolicy,
  createOciStaticEndpointPolicy,
  type OciHostnameTemplate,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'

/**
 * Queue endpoint inventory: https://docs.oracle.com/en-us/iaas/api/specs/index.json
 */
const QUEUE_REGIONS = new Set([
  'af-casablanca-1',
  'af-johannesburg-1',
  'ap-batam-1',
  'ap-chuncheon-1',
  'ap-hyderabad-1',
  'ap-kulai-2',
  'ap-melbourne-1',
  'ap-mumbai-1',
  'ap-osaka-1',
  'ap-seoul-1',
  'ap-singapore-1',
  'ap-singapore-2',
  'ap-sydney-1',
  'ap-tokyo-1',
  'ca-montreal-1',
  'ca-toronto-1',
  'eu-amsterdam-1',
  'eu-frankfurt-1',
  'eu-jovanovac-1',
  'eu-madrid-1',
  'eu-madrid-3',
  'eu-marseille-1',
  'eu-milan-1',
  'eu-paris-1',
  'eu-stockholm-1',
  'eu-turin-1',
  'eu-zurich-1',
  'il-jerusalem-1',
  'me-abudhabi-1',
  'me-dubai-1',
  'me-jeddah-1',
  'me-riyadh-1',
  'mx-monterrey-1',
  'mx-queretaro-1',
  'sa-bogota-1',
  'sa-santiago-1',
  'sa-saopaulo-1',
  'sa-valparaiso-1',
  'sa-vinhedo-1',
  'uk-cardiff-1',
  'uk-london-1',
  'us-ashburn-1',
  'us-chicago-1',
  'us-phoenix-1',
  'us-sanjose-1',
])
const REGIONAL_CONTROL_REGIONS = new Set([
  'ap-hyderabad-1',
  'ap-kulai-2',
  'mx-monterrey-1',
  'mx-queretaro-1',
  'us-chicago-1',
])

function policies(hostnameTemplate: OciHostnameTemplate) {
  const control = createOciStaticEndpointPolicy({
    serviceId: 'oci-queue',
    serviceName: 'messaging',
    hostnameTemplate,
  })
  return {
    control,
    data: (['regional-oci', 'regional'] as const).map((template) =>
      createOciDiscoveredEndpointPolicy({
        serviceId: 'oci-queue',
        serviceName: 'queue.messaging',
        hostnameTemplate: template,
        responsePolicy: control,
        source: { kind: 'json', path: ['messagesEndpoint'] },
      })
    ),
  }
}

const regionalOciPolicies = policies('regional-oci')
const regionalPolicies = policies('regional')

export interface PreparedOciQueueClient {
  client: OciClient
  control: OciPreparedEndpoint
  policies: ReturnType<typeof policies>
}

export async function prepareOciQueueClient(client: OciClient): Promise<PreparedOciQueueClient> {
  /**
   * Preparation performs no request and exposes only the credential-bound effective region.
   */
  const initial = await client.prepareStaticEndpoint(regionalOciPolicies.control)
  if (!QUEUE_REGIONS.has(initial.region.id)) throw new OciClientError('invalid_endpoint')
  const selected = REGIONAL_CONTROL_REGIONS.has(initial.region.id)
    ? regionalPolicies
    : regionalOciPolicies
  const control =
    selected === regionalOciPolicies
      ? initial
      : await client.prepareStaticEndpoint(selected.control)
  return { client, control, policies: selected }
}

export async function discoverOciQueueEndpoint(
  prepared: PreparedOciQueueClient,
  queueId: string,
  signal?: AbortSignal
): Promise<OciPreparedEndpoint> {
  signal?.throwIfAborted()
  const response = await prepared.client.request({
    endpoint: prepared.control,
    method: 'GET',
    encodedPath: `/20210201/queues/${encodeURIComponent(queueId)}`,
    timeoutMs: 10_000,
    maxResponseBytes: 1024 * 1024,
    retry: { kind: 'safe', maxAttempts: 2 },
    signal,
  })
  if (response.status !== 200) throw new OciClientError('invalid_endpoint')
  /**
   * Only these code-owned Queue host forms are accepted; neither attempt performs network I/O.
   */
  for (const policy of prepared.policies.data) {
    try {
      return await prepared.client.prepareDiscoveredEndpoint(policy, response)
    } catch (error) {
      if (!(error instanceof OciClientError) || error.code !== 'invalid_endpoint') throw error
    }
  }
  throw new OciClientError('invalid_endpoint')
}
