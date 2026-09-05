import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_OUTPUTS,
  type OciStreamingResponse,
  type OciStreamingUpdateStreamParams,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingUpdateStreamTool: InternalToolConfig<
  OciStreamingUpdateStreamParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_update_stream',
  name: 'OCI Streaming Update Stream',
  description:
    'Update stream tags or move it to a compatible stream pool. Partition count and retention are immutable.',
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
    streamPoolId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Freeform tag object. Update replaces tags; an empty object clears them.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Defined tags keyed by namespace and tag name, with string values.',
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
      operation: 'update_stream',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      streamPoolId: params.streamPoolId,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_OUTPUTS,
  },
}
