import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_POOL_OUTPUTS,
  type OciStreamingGetStreamPoolParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingGetStreamPoolTool: InternalToolConfig<
  OciStreamingGetStreamPoolParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_get_stream_pool',
  name: 'OCI Streaming Get Stream Pool',
  description: 'Get a stream pool, its encryption settings, and native REST configuration.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    streamPoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'get_stream_pool',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamPoolId: params.streamPoolId,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_POOL_OUTPUTS,
  },
}
