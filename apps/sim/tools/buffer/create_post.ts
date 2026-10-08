import { bufferInputDescription } from '@/tools/buffer/schema'
import {
  type BufferCreatePostParams,
  type BufferPostResponse,
  bufferStringList,
  POST_OUTPUT_PROPERTIES,
} from '@/tools/buffer/types'
import type { InternalToolConfig } from '@/tools/types'

export const bufferCreatePostTool: InternalToolConfig<BufferCreatePostParams, BufferPostResponse> =
  {
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
        description:
          'Publish time as an ISO 8601 timestamp (required when mode is customScheduled)',
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
          'Image or video to attach — an uploaded file, a file reference from a previous block, or a publicly accessible URL. Buffer downloads the media at publish time; uploaded files are shared via a link valid for 7 days, so use a public URL for posts scheduled further out',
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
      assets: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: `Array of assets: ${bufferInputDescription('AssetInput')}. Choose exactly one variant per asset. Omit when using media. On edit, [] clears attachments and omission preserves them.`,
      },
      metadata: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: bufferInputDescription('PostInputMetaData'),
      },
      aiAssisted: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether AI assisted with creating the post',
      },
      draftId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Draft identifier associated with the post',
      },
      ideaId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Source idea identifier',
      },
      source: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Source application identifier',
      },
      tagIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of tag IDs; on edit, [] clears tags and omission preserves them',
      },
      needsApproval: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Request approval on creation (default false)',
      },
    },

    operation: {
      input: (params) => ({
        apiKey: params.apiKey,
        channelId: params.channelId,
        text: params.text,
        mode: params.mode,
        schedulingType: params.schedulingType,
        dueAt: params.dueAt,
        saveToDraft: params.saveToDraft,
        media: params.media,
        mediaType: params.mediaType,
        mediaAltText: params.mediaAltText,
        assets: params.assets,
        metadata: params.metadata,
        aiAssisted: params.aiAssisted,
        draftId: params.draftId,
        ideaId: params.ideaId,
        source: params.source,
        tagIds: params.tagIds == null ? params.tagIds : bufferStringList(params.tagIds),
        needsApproval: params.needsApproval,
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
