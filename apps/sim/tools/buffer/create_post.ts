import {
  type BufferCreatePostParams,
  type BufferPostResponse,
  POST_OUTPUT_PROPERTIES,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

export const bufferCreatePostTool: ToolConfig<BufferCreatePostParams, BufferPostResponse> = {
  id: 'buffer_create_post',
  name: 'Buffer Create Post',
  description:
    'Create a post in Buffer for a channel — add it to the queue, share it immediately, schedule it for a specific time, or save it as a draft, optionally with an image or video attachment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel to create the post for (find it with the Get Channels operation)',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text content of the post (required unless media is attached)',
    },
    mode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'How to share the post: addToQueue, shareNext, shareNow, or customScheduled (requires dueAt)',
    },
    schedulingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How the post publishes: automatic (Buffer publishes it, default) or notification (you get a mobile reminder)',
    },
    dueAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Publish time as an ISO 8601 timestamp (required when mode is customScheduled)',
    },
    saveToDraft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Save the post as a draft instead of scheduling it',
    },
    media: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image or video to attach — an uploaded file, a file reference from a previous block, or a publicly accessible URL',
    },
    mediaAltText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alt text for an attached image',
    },
  },

  request: {
    url: '/api/tools/buffer/create-post',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      channelId: params.channelId,
      text: params.text,
      mode: params.mode,
      schedulingType: params.schedulingType,
      dueAt: params.dueAt,
      saveToDraft: params.saveToDraft,
      media: params.media,
      mediaAltText: params.mediaAltText,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to create post')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    post: {
      type: 'object',
      description: 'The created post',
      properties: POST_OUTPUT_PROPERTIES,
    },
  },
}
