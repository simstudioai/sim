import {
  OCI_STREAMING_CURSOR_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingCreateCursorParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingCreateCursorTool: InternalToolConfig<
  OciStreamingCreateCursorParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_create_cursor',
  name: 'OCI Streaming Create Cursor',
  description:
    'Create a five-minute individual partition cursor at an explicit position. Offsets are decimal strings, local to a partition.',
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
    partition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Partition identifier as a non-negative decimal string. Offsets are local to this partition.',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cursor position: AT_TIME, LATEST, or TRIM_HORIZON; individual cursors also support AT_OFFSET and AFTER_OFFSET.',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Non-negative signed 64-bit offset as a decimal string; never use a JavaScript number. Required for AT_OFFSET and AFTER_OFFSET.',
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
      operation: 'create_cursor',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      partition: params.partition,
      type: params.type,
      offset: params.offset,
      time: params.time,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_CURSOR_OUTPUTS,
  },
}
