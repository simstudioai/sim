import { TIMESTAMP_OUTPUT, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListPagePropertiesParams {
  accessToken: string
  domain: string
  pageId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListPagePropertiesResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    properties: Array<{
      id: string
      key: string
      value: any
      version: {
        number: number
        message?: string
        createdAt?: string
      } | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListPagePropertiesTool: ToolConfig<
  ConfluenceListPagePropertiesParams,
  ConfluenceListPagePropertiesResponse
> = {
  id: 'confluence_list_page_properties',
  name: 'Confluence List Page Properties',
  description: 'List all custom properties (metadata) attached to a Confluence page.',
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
      description: 'The ID of the page to list properties from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of properties to return (default: 50, max: 250)',
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
    url: (params: ConfluenceListPagePropertiesParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        limit: String(params.limit || 50),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/page-properties?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListPagePropertiesParams) => ({
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
        pageId: data.pageId ?? '',
        properties: data.properties ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page' },
    properties: {
      type: 'array',
      description: 'Array of content properties',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Property ID' },
          key: { type: 'string', description: 'Property key' },
          value: { type: 'json', description: 'Property value (can be any JSON)' },
          version: {
            type: 'object',
            description: 'Version information',
            properties: VERSION_OUTPUT_PROPERTIES,
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
