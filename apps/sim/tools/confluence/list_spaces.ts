import { SPACES_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListSpacesParams {
  accessToken: string
  domain: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListSpacesResponse {
  success: boolean
  output: {
    ts: string
    spaces: Array<{
      id: string
      name: string
      key: string
      type: string
      status: string
    }>
    nextCursor: string | null
  }
}

export const confluenceListSpacesTool: ToolConfig<
  ConfluenceListSpacesParams,
  ConfluenceListSpacesResponse
> = {
  id: 'confluence_list_spaces',
  name: 'Confluence List Spaces',
  description: 'List all Confluence spaces accessible to the user.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of spaces to return (default: 25, max: 250)',
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
    url: (params: ConfluenceListSpacesParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        limit: String(params.limit || 25),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/spaces?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListSpacesParams) => {
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
        spaces: data.spaces || [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaces: SPACES_OUTPUT,
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
