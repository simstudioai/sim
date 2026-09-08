import {
  OCI_STREAMING_GROUP_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingGetGroupParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingGetGroupTool: InternalToolConfig<
  OciStreamingGetGroupParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_get_group',
  name: 'OCI Streaming Get Group',
  description: 'Read current group reservations and exact committed offsets. No automatic retries.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    streamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stream OCID. Message operations also require GetStream permission for authenticated endpoint discovery.',
    },
    groupName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Consumer group name. Creating a group cursor joins the group and may rebalance partitions.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'get_group',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      groupName: params.groupName,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_GROUP_OUTPUTS,
  },
}
