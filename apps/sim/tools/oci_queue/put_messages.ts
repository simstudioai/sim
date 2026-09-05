import {
  OCI_QUEUE_MESSAGES_PUBLISHED_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueuePutMessagesParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueuePutMessagesTool: InternalToolConfig<
  OciQueuePutMessagesParams,
  OciQueueResponse
> = {
  id: 'oci_queue_put_messages',
  name: 'OCI Queue Put Messages',
  description:
    'Publish one batch of 1–20 messages with one OCI client attempt; keep workflow block retries disabled. Preserve the returned order; Oracle does not document positional correlation or atomicity guarantees.',
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
    messages: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 1–20 {content, metadata?: {channelId, customProperties?}} messages. UTF-8 content is at most 256 KiB each; serialized batch is at most 512 KiB.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      messages: params.messages,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    messages: OCI_QUEUE_MESSAGES_PUBLISHED_OUTPUT,
  },
}
