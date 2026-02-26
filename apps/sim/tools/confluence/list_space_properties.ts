import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
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
    properties: Array<{
      id: string
      key: string
      value: unknown
    }>
    spaceId: string
    nextCursor: string | null
  }
}

export const confluenceListSpacePropertiesTool: ToolConfig<
  ConfluenceListSpacePropertiesParams,
  ConfluenceListSpacePropertiesResponse
> = {
  id: 'confluence_list_space_properties',
  name: 'Confluence List Space Properties',
  description: 'List properties on a Confluence space.',
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
      description: 'Space ID to list properties for',
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
    url: () => '/api/tools/confluence/space-properties',
    method: 'POST',
    headers: (params: ConfluenceListSpacePropertiesParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListSpacePropertiesParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      spaceId: params.spaceId,
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
        properties: data.properties || [],
        spaceId: data.spaceId ?? '',
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    properties: {
      type: 'array',
      description: 'Array of space properties',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Property ID' },
          key: { type: 'string', description: 'Property key' },
          value: { type: 'json', description: 'Property value' },
        },
      },
    },
    spaceId: { type: 'string', description: 'Space ID' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
