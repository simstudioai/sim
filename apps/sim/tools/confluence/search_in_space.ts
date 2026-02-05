import { SEARCH_RESULT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceSearchInSpaceParams {
  accessToken: string
  domain: string
  spaceKey: string
  query?: string
  contentType?: string
  limit?: number
  cloudId?: string
}

export interface ConfluenceSearchInSpaceResponse {
  success: boolean
  output: {
    ts: string
    spaceKey: string
    totalSize: number
    results: Array<{
      id: string
      title: string
      type: string
      status: string | null
      url: string
      excerpt: string
      lastModified: string | null
    }>
  }
}

export const confluenceSearchInSpaceTool: ToolConfig<
  ConfluenceSearchInSpaceParams,
  ConfluenceSearchInSpaceResponse
> = {
  id: 'confluence_search_in_space',
  name: 'Confluence Search in Space',
  description:
    'Search for content within a specific Confluence space. Optionally filter by text query and content type.',
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
    spaceKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key of the Confluence space to search in (e.g., "ENG", "HR")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text search query. If not provided, returns all content in the space.',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by content type: page, blogpost, attachment, or comment',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 25, max: 250)',
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
    url: () => '/api/tools/confluence/search-in-space',
    method: 'POST',
    headers: (params: ConfluenceSearchInSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceSearchInSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceKey: params.spaceKey?.trim(),
      query: params.query,
      contentType: params.contentType,
      limit: params.limit ? Number(params.limit) : 25,
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        spaceKey: data.spaceKey ?? '',
        totalSize: data.totalSize ?? 0,
        results: data.results ?? [],
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceKey: {
      type: 'string',
      description: 'The space key that was searched',
    },
    totalSize: {
      type: 'number',
      description: 'Total number of matching results',
    },
    results: {
      type: 'array',
      description: 'Array of search results',
      items: {
        type: 'object',
        properties: SEARCH_RESULT_ITEM_PROPERTIES,
      },
    },
  },
}
