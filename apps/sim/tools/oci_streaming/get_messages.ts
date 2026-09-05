import {
  OCI_STREAMING_MESSAGES_OUTPUTS,
  OCI_STREAMING_RESPONSE_OUTPUTS,
  type OciStreamingGetMessagesParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingGetMessagesTool: InternalToolConfig<
  OciStreamingGetMessagesParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_get_messages',
  name: 'OCI Streaming Get Messages',
  description:
    'Read one bounded batch, including empty batches, and return nextCursor. No polling or retries. With commitOnGet enabled, reads can commit the prior batch.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum messages in one batch: default 100, maximum 1,000. Empty batches still return nextCursor.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'get_messages',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      streamId: params.streamId,
      cursor: params.cursor,
      limit: params.limit,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_MESSAGES_OUTPUTS,
  },
}
