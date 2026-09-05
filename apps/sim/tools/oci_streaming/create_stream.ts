import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_OUTPUTS,
  type OciStreamingCreateStreamParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingCreateStreamTool: InternalToolConfig<
  OciStreamingCreateStreamParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_create_stream',
  name: 'OCI Streaming Create Stream',
  description:
    'Create a stream. Returned lifecycle state and work request identify provisioning progress, not completion.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resource name; list operations match the exact name.',
    },
    partitions: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Positive partition count. Cannot be changed after stream creation.',
    },
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. For list/create stream, supply exactly one of compartmentId or streamPoolId.',
    },
    streamPoolId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
    retentionInHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Retention in hours, 24 to 168; Oracle defaults to 24. Cannot be changed after creation.',
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
  },
  operation: {
    input: (params) => ({
      operation: 'create_stream',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      name: params.name,
      partitions: params.partitions,
      compartmentId: params.compartmentId,
      streamPoolId: params.streamPoolId,
      retentionInHours: params.retentionInHours,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_OUTPUTS,
  },
}
