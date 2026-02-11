import { PAGE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetPagesByLabelParams {
  accessToken: string
  domain: string
  labelId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceGetPagesByLabelResponse {
  success: boolean
  output: {
    ts: string
    labelId: string
    pages: Array<{
      id: string
      title: string
      status: string | null
      spaceId: string | null
      parentId: string | null
      authorId: string | null
      createdAt: string | null
      version: {
        number: number
        message?: string
        createdAt?: string
      } | null
    }>
    nextCursor: string | null
  }
}

export const confluenceGetPagesByLabelTool: ToolConfig<
  ConfluenceGetPagesByLabelParams,
  ConfluenceGetPagesByLabelResponse
> = {
  id: 'confluence_get_pages_by_label',
  name: 'Confluence Get Pages by Label',
  description: 'Retrieve all pages that have a specific label applied.',
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
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the label to get pages for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pages to return (default: 50, max: 250)',
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
    url: (params: ConfluenceGetPagesByLabelParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        labelId: params.labelId,
        limit: String(params.limit || 50),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/pages-by-label?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceGetPagesByLabelParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        labelId: data.labelId ?? '',
        pages: data.pages ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    labelId: { type: 'string', description: 'ID of the label' },
    pages: {
      type: 'array',
      description: 'Array of pages with this label',
      items: {
        type: 'object',
        properties: PAGE_ITEM_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
