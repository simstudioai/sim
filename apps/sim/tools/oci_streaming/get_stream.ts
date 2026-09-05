import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_OUTPUTS,
  type OciStreamingGetStreamParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingGetStreamTool: InternalToolConfig<
  OciStreamingGetStreamParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_get_stream',
  name: 'OCI Streaming Get Stream',
  description: 'Get stream configuration and its authenticated message endpoint.',
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
  },
  operation: {
    input: (params) => ({
      operation: 'get_stream',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_OUTPUTS,
  },
}
