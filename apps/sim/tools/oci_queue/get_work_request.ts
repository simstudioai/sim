import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_RETRY_AFTER_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUEST_OUTPUT,
  type OciQueueGetWorkRequestParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueGetWorkRequestTool: InternalToolConfig<
  OciQueueGetWorkRequestParams,
  OciQueueResponse
> = {
  id: 'oci_queue_get_work_request',
  name: 'OCI Queue Get Work Request',
  description: 'Inspect the status and resources of an asynchronous Queue work request.',
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
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue work request OCID.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      workRequestId: params.workRequestId,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    retryAfter: OCI_QUEUE_RETRY_AFTER_OUTPUT,
    workRequest: OCI_QUEUE_WORK_REQUEST_OUTPUT,
  },
}
