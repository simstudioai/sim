import { SPACE_DESCRIPTION_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  name?: string
  description?: string
  cloudId?: string
}

export interface ConfluenceUpdateSpaceResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    name: string
    key: string
    type: string
    status: string
    url: string
    description: { value: string; representation: string } | null
  }
}

export const confluenceUpdateSpaceTool: ToolConfig<
  ConfluenceUpdateSpaceParams,
  ConfluenceUpdateSpaceResponse
> = {
  id: 'confluence_update_space',
  name: 'Confluence Update Space',
  description: 'Update a Confluence space name or description.',
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
      description: 'ID of the space to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the space',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the space',
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
    url: () => '/api/tools/confluence/space',
    method: 'PUT',
    headers: (params: ConfluenceUpdateSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdateSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      spaceId: params.spaceId,
      name: params.name,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        spaceId: data.id ?? '',
        name: data.name ?? '',
        key: data.key ?? '',
        type: data.type ?? '',
        status: data.status ?? '',
        url: data._links?.webui ?? '',
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'Updated space ID' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space type' },
    status: { type: 'string', description: 'Space status' },
    url: { type: 'string', description: 'URL to view the space' },
    description: {
      type: 'object',
      description: 'Space description',
      properties: SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
      optional: true,
    },
  },
}
