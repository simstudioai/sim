import { SPACE_PROPERTY_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListSpacePropertiesParams {
  accessToken: string
  domain: string
  spaceId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListSpacePropertiesResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    properties: Array<Record<string, unknown>>
    nextCursor: string | null
  }
}

export const confluenceListSpacePropertiesTool: ToolConfig<
  ConfluenceListSpacePropertiesParams,
  ConfluenceListSpacePropertiesResponse
> = {
  id: 'confluence_list_space_properties',
  name: 'Confluence List Space Properties',
  description: 'List all content properties on a Confluence space.',
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
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the space to list properties from',
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
    url: (params: ConfluenceListSpacePropertiesParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        spaceId: params.spaceId,
        limit: String(params.limit || 50),
      })
      if (params.cursor) query.set('cursor', params.cursor)
      if (params.cloudId) query.set('cloudId', params.cloudId)
      return `/api/tools/confluence/space-properties?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListSpacePropertiesParams) => ({
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
        spaceId: data.spaceId ?? '',
        properties: data.properties ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'ID of the space' },
    properties: {
      type: 'array',
      description: 'Array of space properties',
      items: {
        type: 'object',
        properties: SPACE_PROPERTY_ITEM_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
