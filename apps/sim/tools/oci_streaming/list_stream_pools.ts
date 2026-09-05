import {
  OCI_STREAMING_NEXT_PAGE_OUTPUT,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_POOLS_OUTPUTS,
  type OciStreamingListStreamPoolsParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingListStreamPoolsTool: InternalToolConfig<
  OciStreamingListStreamPoolsParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_list_stream_pools',
  name: 'OCI Streaming List Stream Pools',
  description: 'List one page of native OCI stream pools.',
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
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by resource OCID.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource name; list operations match the exact name.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CREATING, ACTIVE, DELETING, DELETED, FAILED, or UPDATING.',
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
      operation: 'list_stream_pools',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      compartmentId: params.compartmentId,
      id: params.id,
      name: params.name,
      lifecycleState: params.lifecycleState,
      limit: params.limit,
      page: params.page,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_POOLS_OUTPUTS,
    nextPage: OCI_STREAMING_NEXT_PAGE_OUTPUT,
  },
}
