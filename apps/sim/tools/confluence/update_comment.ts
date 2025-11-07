import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateCommentParams {
  accessToken: string
  domain: string
  commentId: string
  comment: string
  cloudId?: string
}

export interface ConfluenceUpdateCommentResponse {
  success: boolean
  output: {
    ts: string
    commentId: string
    updated: boolean
  }
}

export const confluenceUpdateCommentTool: ToolConfig<
  ConfluenceUpdateCommentParams,
  ConfluenceUpdateCommentResponse
> = {
  id: 'confluence_update_comment',
  name: 'Confluence Update Comment',
  description: 'Update an existing comment on a Confluence page.',
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
      description: 'Confluence comment ID to update',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Updated comment text in Confluence storage format',
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
    method: 'PUT',
    headers: (params: ConfluenceUpdateCommentParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceUpdateCommentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        commentId: params.commentId,
        comment: params.comment,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        commentId: data.id || data.commentId,
        updated: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of update' },
    commentId: { type: 'string', description: 'Updated comment ID' },
    updated: { type: 'boolean', description: 'Update status' },
  },
}
