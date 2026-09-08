import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingDeleteStreamParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingDeleteStreamTool: InternalToolConfig<
  OciStreamingDeleteStreamParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_delete_stream',
  name: 'OCI Streaming Delete Stream',
  description:
    'Delete a stream and its retained messages. This is destructive; an accepted deletion may still be in progress.',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional ETag for optimistic concurrency. A mismatch fails without overwriting the resource.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'delete_stream',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
  },
}
