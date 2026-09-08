import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_UPDATED_MESSAGE_OUTPUT,
  type OciQueueResponse,
  type OciQueueUpdateMessageParams,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueUpdateMessageTool: InternalToolConfig<
  OciQueueUpdateMessageParams,
  OciQueueResponse
> = {
  id: 'oci_queue_update_message',
  name: 'OCI Queue Update Message',
  description:
    'Change one received message visibility from now. Zero releases it; the current receipt is required.',
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
    messageReceipt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exact current receipt returned by Get Messages. Preserve whitespace and punctuation; do not use the message ID.',
    },
    visibilityInSeconds: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Visibility duration: 0–43200 seconds; queue defaults require at least 1. Zero releases a received message.',
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
      messageReceipt: params.messageReceipt,
      visibilityInSeconds: params.visibilityInSeconds,
      consumerGroupId: params.consumerGroupId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    updatedMessage: OCI_QUEUE_UPDATED_MESSAGE_OUTPUT,
  },
}
