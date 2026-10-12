import { bufferInputDescription } from '@/tools/buffer/schema'
import {
  type BufferEditPostParams,
  type BufferPostResponse,
  bufferStringList,
  POST_OUTPUT_PROPERTIES,
} from '@/tools/buffer/types'
import type { InternalToolConfig } from '@/tools/types'

export const bufferEditPostTool: InternalToolConfig<BufferEditPostParams, BufferPostResponse> = {
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Change the share mode to addToQueue, shareNext, shareNow, or customScheduled (requires dueAt). Omit to keep the current schedule',
    },
    schedulingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Change how the post publishes: automatic (Buffer publishes it) or notification (mobile reminder). Omit to keep the current publishing method',
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
    assets: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription(
        'AssetInput',
        'Array of image, video, or document assets. Choose exactly one variant per asset. Omit when using media. An empty array clears attachments; omission preserves them.'
      ),
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription(
        'PostInputMetaData',
        'Network-specific settings, including threads, link attachments, and publishing options.'
      ),
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
    approvalChange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Draft approval change: request submits for approval, revert withdraws the request',
    },
  },

  operation: {
    input: (params) => ({
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
      assets: params.assets,
      metadata: params.metadata,
      aiAssisted: params.aiAssisted,
      draftId: params.draftId,
      ideaId: params.ideaId,
      source: params.source,
      tagIds: params.tagIds == null ? params.tagIds : bufferStringList(params.tagIds),
      approvalChange: params.approvalChange,
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
