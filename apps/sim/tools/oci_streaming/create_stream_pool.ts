import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_STREAM_POOL_OUTPUTS,
  type OciStreamingCreateStreamPoolParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingCreateStreamPoolTool: InternalToolConfig<
  OciStreamingCreateStreamPoolParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_create_stream_pool',
  name: 'OCI Streaming Create Stream Pool',
  description:
    'Create a public stream pool. Only an explicit retry token enables tokenized retries; provisioning may be asynchronous.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resource name; list operations match the exact name.',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. For list/create stream, supply exactly one of compartmentId or streamPoolId.',
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
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CreateStreamPool only: explicit idempotency token, up to 255 characters. Enables at most two attempts with identical bytes and token.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'create_stream_pool',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      name: params.name,
      compartmentId: params.compartmentId,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      customEncryptionKeyDetails: params.customEncryptionKeyDetails,
      kafkaSettings: params.kafkaSettings,
      retryToken: params.retryToken,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_STREAM_POOL_OUTPUTS,
  },
}
