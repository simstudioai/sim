import {
  OCI_QUEUE_CHANNELS_OUTPUT,
  OCI_QUEUE_NEXT_PAGE_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueListChannelsParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueListChannelsTool: InternalToolConfig<
  OciQueueListChannelsParams,
  OciQueueResponse
> = {
  id: 'oci_queue_list_channels',
  name: 'OCI Queue List Channels',
  description:
    'List one approximate page of nonempty channels. This operation does not create or delete channels.',
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
    channelFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional literal channel ID filter. Use documented channel values; no wildcard syntax is assumed.',
    },
    consumerGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional existing consumer group ID where Oracle supports it. Omit for the primary group.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum items in this page (1–1000); receiving accepts only 1–20.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage token from a previous response.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      channelFilter: params.channelFilter,
      consumerGroupId: params.consumerGroupId,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    nextPage: OCI_QUEUE_NEXT_PAGE_OUTPUT,
    channels: OCI_QUEUE_CHANNELS_OUTPUT,
  },
}
