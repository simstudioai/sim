import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingDeleteStreamPoolParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingDeleteStreamPoolTool: InternalToolConfig<
  OciStreamingDeleteStreamPoolParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_delete_stream_pool',
  name: 'OCI Streaming Delete Stream Pool',
  description:
    'Delete a non-default stream pool and ALL streams and retained messages inside it. Deletion is destructive and may be asynchronous.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    streamPoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
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
      operation: 'delete_stream_pool',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamPoolId: params.streamPoolId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
  },
}
