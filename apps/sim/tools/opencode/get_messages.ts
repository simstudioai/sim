import type { OpenCodeGetMessagesParams, OpenCodeGetMessagesResponse } from '@/tools/opencode/types'
import type { ToolConfig } from '@/tools/types'

export const openCodeGetMessagesTool: ToolConfig<
  OpenCodeGetMessagesParams,
  OpenCodeGetMessagesResponse
> = {
  id: 'opencode_get_messages',
  name: 'OpenCode Get Messages',
  description: 'Retrieve the current message history for an OpenCode thread.',
  version: '1.0.0',

  params: {
    repository: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Repository configured for the OpenCode session.',
    },
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OpenCode thread ID to inspect.',
    },
  },

  request: {
    url: '/api/tools/opencode/messages',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      repository: params.repository,
      threadId: params.threadId,
    }),
  },

  outputs: {
    threadId: { type: 'string', description: 'OpenCode thread identifier' },
    messages: {
      type: 'array',
      description: 'Messages currently stored in the OpenCode thread.',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Message identifier' },
          role: { type: 'string', description: 'Message role' },
          content: { type: 'string', description: 'Extracted text content' },
          cost: { type: 'number', description: 'Estimated cost for assistant messages' },
          providerId: { type: 'string', description: 'Provider used for assistant messages' },
          modelId: { type: 'string', description: 'Model used for assistant messages' },
          createdAt: { type: 'number', description: 'Unix timestamp in milliseconds' },
        },
      },
    },
    count: { type: 'number', description: 'Number of messages returned' },
  },
}
