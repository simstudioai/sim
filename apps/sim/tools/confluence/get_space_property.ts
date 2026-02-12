import { SPACE_PROPERTY_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetSpacePropertyParams {
  accessToken: string
  domain: string
  spaceId: string
  propertyId: string
  cloudId?: string
}

export interface ConfluenceGetSpacePropertyResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    id: string
    key: string
    value: unknown
    version: { number: number } | null
  }
}

export const confluenceGetSpacePropertyTool: ToolConfig<
  ConfluenceGetSpacePropertyParams,
  ConfluenceGetSpacePropertyResponse
> = {
  id: 'confluence_get_space_property',
  name: 'Confluence Get Space Property',
  description: 'Get a specific content property from a Confluence space by its ID.',
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
      description: 'The ID of the space containing the property',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the property to retrieve',
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
    url: (params: ConfluenceGetSpacePropertyParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        spaceId: params.spaceId,
        propertyId: params.propertyId,
        action: 'get',
      })
      if (params.cloudId) query.set('cloudId', params.cloudId)
      return `/api/tools/confluence/space-properties?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceGetSpacePropertyParams) => ({
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
        id: data.id ?? '',
        key: data.key ?? '',
        value: data.value ?? null,
        version: data.version ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'ID of the space' },
    ...SPACE_PROPERTY_ITEM_PROPERTIES,
  },
}
