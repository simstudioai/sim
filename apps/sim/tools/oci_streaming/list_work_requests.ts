import {
  OCI_STREAMING_NEXT_PAGE_OUTPUT,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_WORK_REQUESTS_OUTPUTS,
  type OciStreamingListWorkRequestsParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingListWorkRequestsTool: InternalToolConfig<
  OciStreamingListWorkRequestsParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_list_work_requests',
  name: 'OCI Streaming List Work Requests',
  description:
    'List one page of Streaming work requests. Oracle currently omits these APIs from its Streaming IAM permission table.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. For list/create stream, supply exactly one of compartmentId or streamPoolId.',
    },
    workRequestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Asynchronous work request OCID.',
    },
    resourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter work requests by affected resource OCID.',
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
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'NAME or TIMECREATED for resources; TIMEACCEPTED for work requests.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ASC or DESC.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'list_work_requests',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      compartmentId: params.compartmentId,
      workRequestId: params.workRequestId,
      resourceId: params.resourceId,
      limit: params.limit,
      page: params.page,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_WORK_REQUESTS_OUTPUTS,
    nextPage: OCI_STREAMING_NEXT_PAGE_OUTPUT,
  },
}
