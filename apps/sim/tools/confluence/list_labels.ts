import { LABEL_ITEM_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListLabelsParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListLabelsResponse {
  success: boolean
  output: {
    ts: string
    labels: Array<{
      id: string
      name: string
      prefix: string
    }>
    nextCursor: string | null
  }
}

export const confluenceListLabelsTool: ToolConfig<
  ConfluenceListLabelsParams,
  ConfluenceListLabelsResponse
> = {
  id: 'confluence_list_labels',
  name: 'Confluence List Labels',
  description: 'List all labels on a Confluence page.',
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
      description: 'Confluence page ID to list labels from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of labels to return (default: 25, max: 250)',
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
    url: (params: ConfluenceListLabelsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        limit: String(params.limit || 25),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/labels?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListLabelsParams) => {
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
        labels: data.labels || [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of retrieval' },
    labels: {
      type: 'array',
      description: 'Array of labels on the page',
      items: {
        type: 'object',
        properties: LABEL_ITEM_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
