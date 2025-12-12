import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateCommentParams {
  accessToken: string
  domain: string
  pageId: string
  comment: string
  cloudId?: string
}

export interface ConfluenceCreateCommentResponse {
  success: boolean
  output: {
    ts: string
    commentId: string
    pageId: string
  }
}

export const confluenceCreateCommentTool: ToolConfig<
  ConfluenceCreateCommentParams,
  ConfluenceCreateCommentResponse
> = {
  id: 'confluence_create_comment',
  name: 'Confluence Create Comment',
  description: 'Add a comment to a Confluence page.',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence page ID to comment on',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment text in Confluence storage format',
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
    url: () => '/api/tools/confluence/comments',
    method: 'POST',
    headers: (params: ConfluenceCreateCommentParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceCreateCommentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
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
        commentId: data.id,
        pageId: data.pageId || '',
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of creation' },
    commentId: { type: 'string', description: 'Created comment ID' },
    pageId: { type: 'string', description: 'Page ID' },
  },
}
