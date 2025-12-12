import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeleteCommentParams {
  accessToken: string
  domain: string
  commentId: string
  cloudId?: string
}

export interface ConfluenceDeleteCommentResponse {
  success: boolean
  output: {
    ts: string
    commentId: string
    deleted: boolean
  }
}

export const confluenceDeleteCommentTool: ToolConfig<
  ConfluenceDeleteCommentParams,
  ConfluenceDeleteCommentResponse
> = {
  id: 'confluence_delete_comment',
  name: 'Confluence Delete Comment',
  description: 'Delete a comment from a Confluence page.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence comment ID to delete',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: () => '/api/tools/confluence/comment',
    method: 'DELETE',
    headers: (params: ConfluenceDeleteCommentParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceDeleteCommentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        commentId: params.commentId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        commentId: data.commentId || '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of deletion' },
    commentId: { type: 'string', description: 'Deleted comment ID' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
