import {
  OCI_QUEUE_NEXT_PAGE_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUESTS_OUTPUT,
  type OciQueueListWorkRequestsParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueListWorkRequestsTool: InternalToolConfig<
  OciQueueListWorkRequestsParams,
  OciQueueResponse
> = {
  id: 'oci_queue_list_work_requests',
  name: 'OCI Queue List Work Requests',
  description: 'List one page of Queue work requests by compartment or work request ID.',
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
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compartment OCID. Required to create a queue; optional for API listing.',
    },
    workRequestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue work request OCID.',
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
      compartmentId: params.compartmentId,
      workRequestId: params.workRequestId,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    nextPage: OCI_QUEUE_NEXT_PAGE_OUTPUT,
    workRequests: OCI_QUEUE_WORK_REQUESTS_OUTPUT,
  },
}
