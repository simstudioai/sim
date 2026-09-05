import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingChangeStreamPoolCompartmentParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingChangeStreamPoolCompartmentTool: InternalToolConfig<
  OciStreamingChangeStreamPoolCompartmentParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_change_stream_pool_compartment',
  name: 'OCI Streaming Change Stream Pool Compartment',
  description: 'Move a stream pool and its streams to another compartment.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    streamPoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. For list/create stream, supply exactly one of compartmentId or streamPoolId.',
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
      operation: 'change_stream_pool_compartment',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamPoolId: params.streamPoolId,
      compartmentId: params.compartmentId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
  },
}
