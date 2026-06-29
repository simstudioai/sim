import type { GoogleDriveComment, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_COMMENT_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveListCommentsParams extends GoogleDriveToolParams {
  fileId: string
  includeDeleted?: boolean
  pageSize?: number
  pageToken?: string
  startModifiedTime?: string
}

interface GoogleDriveListCommentsResponse extends ToolResponse {
  output: {
    comments: GoogleDriveComment[]
    nextPageToken?: string
  }
}

export const listCommentsTool: ToolConfig<
  GoogleDriveListCommentsParams,
  GoogleDriveListCommentsResponse
> = {
  id: 'google_drive_list_comments',
  name: 'List Google Drive Comments',
  description: 'List comments on a file in Google Drive',
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
      description: 'The ID of the file to list comments for',
    },
    includeDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include deleted comments (their content is stripped)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of comments to return (1-100, default 20)',
    },
    startModifiedTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return comments modified after this RFC 3339 timestamp',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The page token to use for pagination',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/comments`
      )
      url.searchParams.append('fields', `nextPageToken,comments(${ALL_COMMENT_FIELDS})`)
      if (params.includeDeleted !== undefined) {
        url.searchParams.append('includeDeleted', String(params.includeDeleted))
      }
      if (params.pageSize) {
        url.searchParams.append('pageSize', String(params.pageSize))
      }
      if (params.startModifiedTime) {
        url.searchParams.append('startModifiedTime', params.startModifiedTime)
      }
      if (params.pageToken) {
        url.searchParams.append('pageToken', params.pageToken)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        comments: (data.comments ?? []) as GoogleDriveComment[],
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'List of comments on the file',
      items: {
        type: 'object',
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
          quotedFileContent: {
            type: 'json',
            description: 'The file content the comment quotes',
          },
          replies: { type: 'json', description: 'Threaded replies to the comment' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of comments',
    },
  },
}
