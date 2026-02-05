import { COMMENTS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListCommentsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  bodyFormat?: string
  cursor?: string
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
    nextCursor: string | null
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
    bodyFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Format for the comment body: storage, atlas_doc_format, view, or export_view (default: storage)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
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
      if (params.bodyFormat) {
        query.set('bodyFormat', params.bodyFormat)
      }
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
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
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        comments: data.comments || [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    comments: COMMENTS_OUTPUT,
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
