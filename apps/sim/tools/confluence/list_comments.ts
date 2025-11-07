import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListCommentsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceListCommentsResponse {
  success: boolean
  output: {
    ts: string
    comments: Array<{
      id: string
      body: string
      createdAt: string
      authorId: string
    }>
  }
}

export const confluenceListCommentsTool: ToolConfig<
  ConfluenceListCommentsParams,
  ConfluenceListCommentsResponse
> = {
  id: 'confluence_list_comments',
  name: 'Confluence List Comments',
  description: 'List all comments on a Confluence page.',
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
      description: 'Confluence page ID to list comments from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of comments to return (default: 25)',
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
    url: (params: ConfluenceListCommentsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        limit: String(params.limit || 25),
      })
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/comments?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListCommentsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceListCommentsParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
        limit: params.limit ? Number(params.limit) : 25,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        comments: data.comments || [],
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of retrieval' },
    comments: { type: 'array', description: 'List of comments' },
  },
}
