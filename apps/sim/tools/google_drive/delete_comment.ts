import type { GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveDeleteCommentParams extends GoogleDriveToolParams {
  fileId: string
  commentId: string
}

interface GoogleDriveDeleteCommentResponse extends ToolResponse {
  output: {
    deleted: boolean
    fileId: string
    commentId: string
  }
}

export const deleteCommentTool: ToolConfig<
  GoogleDriveDeleteCommentParams,
  GoogleDriveDeleteCommentResponse
> = {
  id: 'google_drive_delete_comment',
  name: 'Delete Google Drive Comment',
  description: 'Delete a comment from a file in Google Drive',
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
      description: 'The ID of the file the comment belongs to',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the comment to delete',
    },
  },

  request: {
    url: (params) =>
      `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/comments/${params.commentId?.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (_response: Response, params) => ({
    success: true,
    output: {
      deleted: true,
      fileId: params?.fileId ?? '',
      commentId: params?.commentId ?? '',
    },
  }),

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the comment was successfully deleted' },
    fileId: { type: 'string', description: 'The ID of the file' },
    commentId: { type: 'string', description: 'The ID of the deleted comment' },
  },
}
