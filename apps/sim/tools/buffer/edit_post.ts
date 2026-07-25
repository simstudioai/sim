import {
  type BufferEditPostParams,
  type BufferPostResponse,
  POST_OUTPUT_PROPERTIES,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

export const bufferEditPostTool: ToolConfig<BufferEditPostParams, BufferPostResponse> = {
  id: 'buffer_edit_post',
  name: 'Buffer Edit Post',
  description:
    'Edit an existing Buffer post — update its text, schedule, or media. Attaching new media replaces the existing attachments',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    postId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the post to edit',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New text content of the post',
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
        'Image or video to attach — an uploaded file, a file reference from a previous block, or a publicly accessible URL. Buffer downloads the media at publish time; uploaded files are shared via a link valid for 7 days, so use a public URL for posts scheduled further out. Replaces existing attachments',
    },
    mediaType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Force the attachment type when it cannot be detected from the file or URL: image or video (default auto)',
    },
    mediaAltText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alt text for an attached image',
    },
  },

  request: {
    url: '/api/tools/buffer/edit-post',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      postId: params.postId,
      text: params.text,
      mode: params.mode,
      schedulingType: params.schedulingType,
      dueAt: params.dueAt,
      saveToDraft: params.saveToDraft,
      media: params.media,
      mediaType: params.mediaType,
      mediaAltText: params.mediaAltText,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to edit post')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    post: {
      type: 'object',
      description: 'The updated post',
      properties: POST_OUTPUT_PROPERTIES,
    },
  },
}
