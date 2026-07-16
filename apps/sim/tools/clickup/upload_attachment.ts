import type {
  ClickUpUploadAttachmentParams,
  ClickUpUploadAttachmentResponse,
} from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUploadAttachmentTool: ToolConfig<
  ClickUpUploadAttachmentParams,
  ClickUpUploadAttachmentResponse
> = {
  id: 'clickup_upload_attachment',
  name: 'ClickUp Upload Attachment',
  description: 'Upload a file to a ClickUp task as an attachment',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the task to attach the file to',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'File to attach to the task',
    },
  },

  request: {
    url: '/api/tools/clickup/upload-attachment',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      taskId: params.taskId,
      file: params.file,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to upload ClickUp attachment')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    attachment: {
      type: 'json',
      description: 'The created attachment',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Attachment ID' },
        version: { type: 'string', description: 'Attachment version', nullable: true },
        title: { type: 'string', description: 'Attachment title', nullable: true },
        extension: { type: 'string', description: 'File extension', nullable: true },
        url: { type: 'string', description: 'URL of the uploaded attachment', nullable: true },
        date: {
          type: 'number',
          description: 'Upload timestamp (Unix ms)',
          nullable: true,
        },
        thumbnailSmall: { type: 'string', description: 'Small thumbnail URL', nullable: true },
        thumbnailLarge: { type: 'string', description: 'Large thumbnail URL', nullable: true },
      },
    },
    files: { type: 'file[]', description: 'The uploaded attachment file' },
  },
}
