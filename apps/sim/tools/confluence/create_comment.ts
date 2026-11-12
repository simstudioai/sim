import { VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { InternalToolConfig } from '@/tools/types'

export interface ConfluenceCreateCommentParams {
  accessToken: string
  domain: string
  pageId: string
  comment: string
  parentCommentId?: string
  cloudId?: string
}

export interface ConfluenceCreateCommentResponse {
  success: boolean
  output: {
    ts: string
    commentId: string
    pageId: string
    parentCommentId: string | null
    status: string | null
    version: Record<string, unknown> | null
    webUrl: string | null
  }
}

export const confluenceCreateCommentTool: InternalToolConfig<
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
      visibility: 'user-or-llm',
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
    parentCommentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of a footer or inline comment to reply to. When set, the comment is posted as a reply in that thread.',
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
    input: (params: ConfluenceCreateCommentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
        comment: params.comment,
        parentCommentId: String(params.parentCommentId ?? '').trim() || undefined,
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
        parentCommentId: data.parentCommentId ?? null,
        status: data.status ?? null,
        version: data.version ?? null,
        webUrl: data._links?.webui ?? null,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of creation' },
    commentId: { type: 'string', description: 'Created comment ID' },
    pageId: { type: 'string', description: 'Page ID' },
    parentCommentId: {
      type: 'string',
      description: 'ID of the parent comment when the comment is a reply',
      optional: true,
    },
    status: { type: 'string', description: 'Comment status (e.g., current)', optional: true },
    version: {
      type: 'object',
      description: 'Comment version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
    webUrl: {
      type: 'string',
      description: 'URL to view the comment in Confluence',
      optional: true,
    },
  },
}
