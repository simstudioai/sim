import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetPageChildrenParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceGetPageChildrenResponse {
  success: boolean
  output: {
    ts: string
    parentId: string
    children: Array<{
      id: string
      title: string
      status: string | null
      spaceId: string | null
      childPosition: number | null
      webUrl: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceGetPageChildrenTool: ToolConfig<
  ConfluenceGetPageChildrenParams,
  ConfluenceGetPageChildrenResponse
> = {
  id: 'confluence_get_page_children',
  name: 'Confluence Get Page Children',
  description:
    'Get all child pages of a specific Confluence page. Useful for navigating page hierarchies.',
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
      description: 'The ID of the parent page to get children from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of child pages to return (default: 50, max: 250)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response to get the next page of results',
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
    url: () => '/api/tools/confluence/page-children',
    method: 'POST',
    headers: (params: ConfluenceGetPageChildrenParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceGetPageChildrenParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      limit: params.limit ? Number(params.limit) : 50,
      cursor: params.cursor,
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        parentId: data.parentId ?? '',
        children: data.children ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    parentId: {
      type: 'string',
      description: 'ID of the parent page',
    },
    children: {
      type: 'array',
      description: 'Array of child pages',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Child page ID' },
          title: { type: 'string', description: 'Child page title' },
          status: { type: 'string', description: 'Page status', optional: true },
          spaceId: { type: 'string', description: 'Space ID', optional: true },
          childPosition: { type: 'number', description: 'Position among siblings', optional: true },
          webUrl: { type: 'string', description: 'URL to view the page', optional: true },
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
