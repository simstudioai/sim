import {
  OCI_QUEUE_ERRORS_OUTPUT,
  OCI_QUEUE_NEXT_PAGE_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueListWorkRequestErrorsParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueListWorkRequestErrorsTool: InternalToolConfig<
  OciQueueListWorkRequestErrorsParams,
  OciQueueResponse
> = {
  id: 'oci_queue_list_work_request_errors',
  name: 'OCI Queue List Work Request Errors',
  description: 'List one page of errors for a Queue work request.',
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
    errors: OCI_QUEUE_ERRORS_OUTPUT,
  },
}
