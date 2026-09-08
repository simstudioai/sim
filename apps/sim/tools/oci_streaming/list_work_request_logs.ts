import {
  OCI_STREAMING_LOGS_OUTPUTS,
  OCI_STREAMING_NEXT_PAGE_OUTPUT,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingListWorkRequestLogsParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingListWorkRequestLogsTool: InternalToolConfig<
  OciStreamingListWorkRequestLogsParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_list_work_request_logs',
  name: 'OCI Streaming List Work Request Logs',
  description: 'List one page of logs for a Streaming work request.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asynchronous work request OCID.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One administrative page: default 10, maximum 50.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque nextPage from a previous administrative list. This is not a message cursor.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'list_work_request_logs',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      workRequestId: params.workRequestId,
      limit: params.limit,
      page: params.page,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_LOGS_OUTPUTS,
    nextPage: OCI_STREAMING_NEXT_PAGE_OUTPUT,
  },
}
