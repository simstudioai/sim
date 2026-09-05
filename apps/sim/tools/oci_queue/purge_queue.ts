import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  type OciQueuePurgeQueueParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueuePurgeQueueTool: InternalToolConfig<
  OciQueuePurgeQueueParams,
  OciQueueResponse
> = {
  id: 'oci_queue_purge_queue',
  name: 'OCI Queue Purge Queue',
  description:
    'Purge normal messages, dead-letter messages, or both. Returns asynchronous acceptance.',
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
    purgeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'NORMAL, DLQ, or BOTH. Purging is asynchronous with one OCI client attempt; keep workflow block retries disabled.',
    },
    channelIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional array of channel IDs to purge; omit for all channels.',
    },
    consumerGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional existing consumer group ID where Oracle supports it. Omit for the primary group.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag for optimistic concurrency.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      purgeType: params.purgeType,
      channelIds: params.channelIds,
      consumerGroupId: params.consumerGroupId,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    workRequestId: OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  },
}
