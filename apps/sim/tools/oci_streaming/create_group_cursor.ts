import {
  OCI_STREAMING_CURSOR_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingCreateGroupCursorParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingCreateGroupCursorTool: InternalToolConfig<
  OciStreamingCreateGroupCursorParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_create_group_cursor',
  name: 'OCI Streaming Create Group Cursor',
  description:
    'Create or join a consumer group. Existing groups retain their position; joining may rebalance. commitOnGet defaults to false.',
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
    instanceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Consumer instance name. Oracle generates one if omitted. Reuse deliberately for an existing instance.',
    },
    timeoutInMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Group member timeout in milliseconds, at least 5,000; Oracle defaults to 30,000.',
    },
    commitOnGet: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Default false. True permits subsequent reads to commit prior batches automatically; use only when that behavior is intended.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'create_group_cursor',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      groupName: params.groupName,
      type: params.type,
      time: params.time,
      instanceName: params.instanceName,
      timeoutInMs: params.timeoutInMs,
      commitOnGet: params.commitOnGet,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_CURSOR_OUTPUTS,
  },
}
