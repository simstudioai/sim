import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { InternalToolConfig } from '@/tools/types'

export interface ConfluenceDeleteSpacePropertyParams {
  accessToken: string
  domain: string
  spaceId: string
  propertyId: string
  cloudId?: string
}

export interface ConfluenceDeleteSpacePropertyResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    propertyId: string
    deleted: boolean
  }
}

export const confluenceDeleteSpacePropertyTool: InternalToolConfig<
  ConfluenceDeleteSpacePropertyParams,
  ConfluenceDeleteSpacePropertyResponse
> = {
  id: 'confluence_delete_space_property',
  name: 'Confluence Delete Space Property',
  description: 'Delete a property from a Confluence space.',
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
      visibility: 'user-or-llm',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Space ID the property belongs to',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Property ID to delete',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  operation: {
    input: (params: ConfluenceDeleteSpacePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      spaceId: params.spaceId,
      action: 'delete',
      propertyId: params.propertyId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        spaceId: data.spaceId ?? '',
        propertyId: data.propertyId ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'Space ID' },
    propertyId: { type: 'string', description: 'Deleted property ID' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
