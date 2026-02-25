import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetPageDescendantsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceGetPageDescendantsResponse {
  success: boolean
  output: {
    ts: string
    descendants: Array<{
      id: string
      title: string
      type: string | null
      status: string | null
      spaceId: string | null
      parentId: string | null
      childPosition: number | null
      depth: number | null
    }>
    pageId: string
    nextCursor: string | null
  }
}

export const confluenceGetPageDescendantsTool: ToolConfig<
  ConfluenceGetPageDescendantsParams,
  ConfluenceGetPageDescendantsResponse
> = {
  id: 'confluence_get_page_descendants',
  name: 'Confluence Get Page Descendants',
  description: 'Get all descendants of a Confluence page recursively.',
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
      description: 'Page ID to get descendants for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of descendants to return (default: 50, max: 250)',
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
    url: () => '/api/tools/confluence/page-descendants',
    method: 'POST',
    headers: (params: ConfluenceGetPageDescendantsParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceGetPageDescendantsParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      pageId: params.pageId,
      limit: params.limit,
      cursor: params.cursor,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        descendants: data.descendants || [],
        pageId: data.pageId ?? '',
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    descendants: {
      type: 'array',
      description: 'Array of descendant pages',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Page ID' },
          title: { type: 'string', description: 'Page title' },
          type: {
            type: 'string',
            description: 'Content type (page, whiteboard, database, etc.)',
            optional: true,
          },
          status: { type: 'string', description: 'Page status', optional: true },
          spaceId: { type: 'string', description: 'Space ID', optional: true },
          parentId: { type: 'string', description: 'Parent page ID', optional: true },
          childPosition: { type: 'number', description: 'Position among siblings', optional: true },
          depth: { type: 'number', description: 'Depth in the hierarchy', optional: true },
        },
      },
    },
    pageId: { type: 'string', description: 'Parent page ID' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
