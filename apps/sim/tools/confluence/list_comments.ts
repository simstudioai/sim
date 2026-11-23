import { COMMENT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { InternalToolConfig } from '@/tools/types'

export interface ConfluenceListCommentsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  bodyFormat?: string
  cursor?: string
  commentType?: 'footer' | 'inline'
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

export const confluenceListCommentsTool: InternalToolConfig<
  ConfluenceListCommentsParams,
  ConfluenceListCommentsResponse
> = {
  id: 'confluence_list_comments',
  assistant: { effect: 'read', version: 1 },
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
      visibility: 'user-or-llm',
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
      description: 'Format for the comment body: storage or atlas_doc_format (default: storage)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    commentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which comments to list: footer (comments at the bottom of the page) or inline (comments attached to highlighted text). Default: footer',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  operation: {
    input: (params: ConfluenceListCommentsParams) => {
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
      if (params.commentType) {
        query.set('commentType', params.commentType)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return Object.fromEntries(query)
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
    comments: {
      type: 'array',
      description: 'Array of Confluence comments',
      items: {
        type: 'object',
        properties: {
          ...COMMENT_ITEM_PROPERTIES,
          commentType: {
            type: 'string',
            description: 'Comment type that was listed (footer or inline)',
            optional: true,
          },
          resolutionStatus: {
            type: 'string',
            description: 'Inline comment resolution status (open, reopened, resolved, dangling)',
            optional: true,
          },
          inlineOriginalSelection: {
            type: 'string',
            description: 'Page text the inline comment is attached to',
            optional: true,
          },
          inlineMarkerRef: {
            type: 'string',
            description: 'Marker reference of the highlighted text for an inline comment',
            optional: true,
          },
          webUrl: {
            type: 'string',
            description: 'URL to view the comment in Confluence',
            optional: true,
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
