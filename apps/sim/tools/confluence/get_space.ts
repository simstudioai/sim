import { SPACE_DESCRIPTION_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  cloudId?: string
}

export interface ConfluenceGetSpaceResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    name: string
    key: string
    type: string
    status: string
    url: string
    authorId: string | null
    createdAt: string | null
    homepageId: string | null
    description: {
      value: string
      representation: string
    } | null
  }
}

export const confluenceGetSpaceTool: ToolConfig<
  ConfluenceGetSpaceParams,
  ConfluenceGetSpaceResponse
> = {
  id: 'confluence_get_space',
  name: 'Confluence Get Space',
  description: 'Get details about a specific Confluence space.',
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
      description: 'Confluence space ID to retrieve',
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
    url: (params: ConfluenceGetSpaceParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        spaceId: params.spaceId,
      })
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/space?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceGetSpaceParams) => {
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
        spaceId: data.id,
        name: data.name,
        key: data.key,
        type: data.type,
        status: data.status,
        url: data._links?.webui || '',
        authorId: data.authorId ?? null,
        createdAt: data.createdAt ?? null,
        homepageId: data.homepageId ?? null,
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'Space ID' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space type (global, personal)' },
    status: { type: 'string', description: 'Space status (current, archived)' },
    url: { type: 'string', description: 'URL to view the space in Confluence' },
    authorId: { type: 'string', description: 'Account ID of the space creator', optional: true },
    createdAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the space was created',
      optional: true,
    },
    homepageId: { type: 'string', description: 'ID of the space homepage', optional: true },
    description: {
      type: 'object',
      description: 'Space description content',
      properties: SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
      optional: true,
    },
  },
}
