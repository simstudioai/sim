import {
  OCI_STREAMING_PUBLISH_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingPutMessagesParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingPutMessagesTool: InternalToolConfig<
  OciStreamingPutMessagesParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_put_messages',
  name: 'OCI Streaming Put Messages',
  description:
    'Publish one bounded batch through native REST. Inspect allSucceeded and ordered entries for partial failures. No automatic splitting or replay; retrying can duplicate delivered messages.',
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
    messages: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Ordered array of key/value messages. Maximum 1,000 entries and 1 MiB decoded keys plus values. Keys at most 256 bytes. Values must be nonempty.',
    },
    encoding: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Encoding of every key and value: utf-8 (default) or canonical padded base64.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'put_messages',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      messages: params.messages,
      encoding: params.encoding,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_PUBLISH_OUTPUTS,
  },
}
