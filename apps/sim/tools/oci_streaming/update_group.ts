import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingResponse,
  type OciStreamingUpdateGroupParams,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingUpdateGroupTool: InternalToolConfig<
  OciStreamingUpdateGroupParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_update_group',
  name: 'OCI Streaming Update Group',
  description:
    'Forcefully reset the committed position for ALL consumers in a group. Successful native REST response has no body.',
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
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cursor position: AT_TIME, LATEST, or TRIM_HORIZON; individual cursors also support AT_OFFSET and AFTER_OFFSET.',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'RFC 3339 timestamp, required only for AT_TIME.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'update_group',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      groupName: params.groupName,
      type: params.type,
      time: params.time,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
  },
}
