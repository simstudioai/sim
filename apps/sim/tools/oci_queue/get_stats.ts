import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATS_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueGetStatsParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueGetStatsTool: InternalToolConfig<OciQueueGetStatsParams, OciQueueResponse> = {
  id: 'oci_queue_get_stats',
  name: 'OCI Queue Get Statistics',
  description:
    'Inspect visible, in-flight, and retained-byte counts for the queue and its dead-letter queue.',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service account credential ID.',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional OCI region; defaults to the saved credential region.',
    },
    queueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue OCID. The message endpoint is discovered from authenticated GetQueue.',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional channel ID for statistics.',
    },
    consumerGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional existing consumer group ID where Oracle supports it. Omit for the primary group.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      channelId: params.channelId,
      consumerGroupId: params.consumerGroupId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    stats: OCI_QUEUE_STATS_OUTPUT,
  },
}
