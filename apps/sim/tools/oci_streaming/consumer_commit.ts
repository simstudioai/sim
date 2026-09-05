import {
  OCI_STREAMING_CURSOR_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingConsumerCommitParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingConsumerCommitTool: InternalToolConfig<
  OciStreamingConsumerCommitParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_consumer_commit',
  name: 'OCI Streaming Consumer Commit',
  description:
    'Commit processed group offsets using the nextCursor from the fully processed read batch. Return a replacement cursor; delivery remains at least once.',
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
    cursor: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Opaque cursor, expiring after five minutes. Use the latest read, commit, or heartbeat cursor; never decode or recreate it automatically.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'consumer_commit',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      cursor: params.cursor,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_CURSOR_OUTPUTS,
  },
}
