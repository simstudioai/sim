import { SPACE_PROPERTY_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateSpacePropertyParams {
  accessToken: string
  domain: string
  spaceId: string
  key: string
  value: unknown
  cloudId?: string
}

export interface ConfluenceCreateSpacePropertyResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    propertyId: string
    key: string
    value: unknown
    version: { number: number } | null
  }
}

export const confluenceCreateSpacePropertyTool: ToolConfig<
  ConfluenceCreateSpacePropertyParams,
  ConfluenceCreateSpacePropertyResponse
> = {
  id: 'confluence_create_space_property',
  name: 'Confluence Create Space Property',
  description: 'Create a new content property on a Confluence space.',
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
      description: 'The ID of the space to add the property to',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key/name for the property',
    },
    value: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value for the property (can be any JSON value)',
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
    headers: (params: ConfluenceCreateSpacePropertyParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreateSpacePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      key: params.key,
      value: params.value,
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        spaceId: data.spaceId ?? '',
        propertyId: data.id ?? '',
        key: data.key ?? '',
        value: data.value ?? null,
        version: data.version ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'ID of the space' },
    propertyId: { type: 'string', description: 'ID of the created property' },
    ...SPACE_PROPERTY_ITEM_PROPERTIES,
  },
}
