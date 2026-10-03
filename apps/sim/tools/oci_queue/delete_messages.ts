import {
  OCI_QUEUE_ALL_SUCCEEDED_OUTPUT,
  OCI_QUEUE_CLIENT_FAILURES_OUTPUT,
  OCI_QUEUE_DELETE_ENTRIES_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_SERVER_FAILURES_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueDeleteMessagesParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueDeleteMessagesTool: InternalToolConfig<
  OciQueueDeleteMessagesParams,
  OciQueueResponse
> = {
  id: 'oci_queue_delete_messages',
  name: 'OCI Queue Delete Messages',
  description:
    'Acknowledge 1–20 messages by receipt and return ordered per-entry outcomes and failure counts.',
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
    entries: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 1–20 entries: {receipt} for deletion or {receipt, visibilityInSeconds} for visibility changes.',
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
      entries: params.entries,
      consumerGroupId: params.consumerGroupId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    entries: OCI_QUEUE_DELETE_ENTRIES_OUTPUT,
    clientFailures: OCI_QUEUE_CLIENT_FAILURES_OUTPUT,
    serverFailures: OCI_QUEUE_SERVER_FAILURES_OUTPUT,
    allSucceeded: OCI_QUEUE_ALL_SUCCEEDED_OUTPUT,
  },
}
