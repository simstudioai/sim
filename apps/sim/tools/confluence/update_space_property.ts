import { SPACE_PROPERTY_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateSpacePropertyParams {
  accessToken: string
  domain: string
  spaceId: string
  propertyId: string
  key: string
  value: unknown
  versionNumber: number
  cloudId?: string
}

export interface ConfluenceUpdateSpacePropertyResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    propertyId: string
    key: string
    value: unknown
    version: Record<string, unknown> | null
  }
}

export const confluenceUpdateSpacePropertyTool: ToolConfig<
  ConfluenceUpdateSpacePropertyParams,
  ConfluenceUpdateSpacePropertyResponse
> = {
  id: 'confluence_update_space_property',
  name: 'Confluence Update Space Property',
  description: 'Update a content property on a Confluence space.',
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
      description: 'The ID of the property to update',
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
      description: 'The new value for the property (can be any JSON value)',
    },
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current version number of the property (for optimistic locking)',
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
    method: 'PUT',
    headers: (params: ConfluenceUpdateSpacePropertyParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdateSpacePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      propertyId: params.propertyId?.trim(),
      key: params.key,
      value: params.value,
      versionNumber: params.versionNumber,
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
    propertyId: { type: 'string', description: 'ID of the updated property' },
    ...SPACE_PROPERTY_ITEM_PROPERTIES,
  },
}
