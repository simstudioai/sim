import {
  OCI_QUEUE_ETAG_OUTPUT,
  OCI_QUEUE_QUEUE_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueGetQueueParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueGetQueueTool: InternalToolConfig<OciQueueGetQueueParams, OciQueueResponse> = {
  id: 'oci_queue_get_queue',
  name: 'OCI Queue Get Queue',
  description: 'Get queue configuration and its discovered message endpoint.',
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
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    etag: OCI_QUEUE_ETAG_OUTPUT,
    queue: OCI_QUEUE_QUEUE_OUTPUT,
  },
}
