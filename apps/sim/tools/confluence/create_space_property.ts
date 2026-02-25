import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateSpacePropertyParams {
  accessToken: string
  domain: string
  spaceId: string
  key: string
  value?: unknown
  cloudId?: string
}

export interface ConfluenceCreateSpacePropertyResponse {
  success: boolean
  output: {
    ts: string
    propertyId: string
    key: string
    value: unknown
    spaceId: string
  }
}

export const confluenceCreateSpacePropertyTool: ToolConfig<
  ConfluenceCreateSpacePropertyParams,
  ConfluenceCreateSpacePropertyResponse
> = {
  id: 'confluence_create_space_property',
  name: 'Confluence Create Space Property',
  description: 'Create a property on a Confluence space.',
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
      description: 'Space ID to create the property on',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Property key/name',
    },
    value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property value (JSON)',
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
      cloudId: params.cloudId,
      spaceId: params.spaceId,
      action: 'create',
      key: params.key,
      value: params.value,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        propertyId: data.propertyId ?? '',
        key: data.key ?? '',
        value: data.value ?? null,
        spaceId: data.spaceId ?? '',
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    propertyId: { type: 'string', description: 'Created property ID' },
    key: { type: 'string', description: 'Property key' },
    value: { type: 'json', description: 'Property value' },
    spaceId: { type: 'string', description: 'Space ID' },
  },
}
