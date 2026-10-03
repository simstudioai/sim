import {
  OCI_QUEUE_MESSAGES_RECEIVED_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueGetMessagesParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueGetMessagesTool: InternalToolConfig<
  OciQueueGetMessagesParams,
  OciQueueResponse
> = {
  id: 'oci_queue_get_messages',
  name: 'OCI Queue Get Messages',
  description:
    'Receive one bounded batch of 1–20 messages. This GET changes visibility and delivery counts. The OCI client makes one receive attempt; keep workflow block retries disabled.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum items in this page (1–1000); receiving accepts only 1–20.',
    },
    timeoutInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Long-poll duration: 0–30 seconds. Zero does not wait.',
    },
    visibilityInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Visibility duration: 0–43200 seconds; queue defaults require at least 1. Zero releases a received message.',
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
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      limit: params.limit,
      timeoutInSeconds: params.timeoutInSeconds,
      visibilityInSeconds: params.visibilityInSeconds,
      channelFilter: params.channelFilter,
      consumerGroupId: params.consumerGroupId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    messages: OCI_QUEUE_MESSAGES_RECEIVED_OUTPUT,
  },
}
