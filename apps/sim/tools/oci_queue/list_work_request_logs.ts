import {
  OCI_QUEUE_LOGS_OUTPUT,
  OCI_QUEUE_NEXT_PAGE_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueListWorkRequestLogsParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueListWorkRequestLogsTool: InternalToolConfig<
  OciQueueListWorkRequestLogsParams,
  OciQueueResponse
> = {
  id: 'oci_queue_list_work_request_logs',
  name: 'OCI Queue List Work Request Logs',
  description: 'List one page of logs for a Queue work request.',
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
    logs: OCI_QUEUE_LOGS_OUTPUT,
  },
}
