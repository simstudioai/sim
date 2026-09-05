import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_POOL_OUTPUTS,
  type OciStreamingResponse,
  type OciStreamingUpdateStreamPoolParams,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingUpdateStreamPoolTool: InternalToolConfig<
  OciStreamingUpdateStreamPoolParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_update_stream_pool',
  name: 'OCI Streaming Update Stream Pool',
  description:
    'Update stream pool name, tags, encryption key, or Kafka compatibility settings through native REST.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    streamPoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource name; list operations match the exact name.',
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
    customEncryptionKeyDetails: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Customer-managed encryption key object: {"kmsKeyId":"ocid1.key..."}. Requires the appropriate KMS permissions.',
    },
    kafkaSettings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Native REST pool configuration: autoCreateTopicsEnable, logRetentionHours (1–672), numPartitions (positive). Does not establish Kafka access.',
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
      operation: 'update_stream_pool',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamPoolId: params.streamPoolId,
      name: params.name,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      customEncryptionKeyDetails: params.customEncryptionKeyDetails,
      kafkaSettings: params.kafkaSettings,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_POOL_OUTPUTS,
  },
}
