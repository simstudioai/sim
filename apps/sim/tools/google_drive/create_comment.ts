import type { GoogleDriveComment, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_COMMENT_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveCreateCommentParams extends GoogleDriveToolParams {
  fileId: string
  content: string
  anchor?: string
}

interface GoogleDriveCreateCommentResponse extends ToolResponse {
  output: {
    comment: GoogleDriveComment
  }
}

export const createCommentTool: ToolConfig<
  GoogleDriveCreateCommentParams,
  GoogleDriveCreateCommentResponse
> = {
  id: 'google_drive_create_comment',
  name: 'Create Google Drive Comment',
  description: 'Add a comment to a file in Google Drive',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to comment on',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The plain text content of the comment',
    },
    anchor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A region of the document the comment refers to (JSON anchor string)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/comments`
      )
      url.searchParams.append('fields', ALL_COMMENT_FIELDS)
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        content: params.content,
      }
      if (params.anchor) {
        body.anchor = params.anchor
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as GoogleDriveComment

    return {
      success: true,
      output: {
        comment: data,
      },
    }
  },

  outputs: {
    comment: {
      type: 'json',
      description: 'The created comment',
      properties: {
        id: { type: 'string', description: 'Comment ID' },
        content: { type: 'string', description: 'Plain text content of the comment' },
        htmlContent: { type: 'string', description: 'HTML-formatted content of the comment' },
        author: { type: 'json', description: 'User who authored the comment' },
        createdTime: { type: 'string', description: 'When the comment was created' },
        modifiedTime: { type: 'string', description: 'When the comment was last modified' },
        resolved: { type: 'boolean', description: 'Whether the comment has been resolved' },
        deleted: { type: 'boolean', description: 'Whether the comment has been deleted' },
        anchor: { type: 'string', description: 'Region of the document the comment refers to' },
        quotedFileContent: { type: 'json', description: 'The file content the comment quotes' },
        replies: { type: 'json', description: 'Threaded replies to the comment' },
      },
    },
  },
}
