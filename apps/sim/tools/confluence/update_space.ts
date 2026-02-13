import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  name?: string
  description?: string
  status?: string
  cloudId?: string
}

export interface ConfluenceUpdateSpaceResponse {
  success: boolean
  output: {
    ts: string
    id: string
    key: string
    name: string
    type: string
    status: string
    updated: boolean
  }
}

export const confluenceUpdateSpaceTool: ToolConfig<
  ConfluenceUpdateSpaceParams,
  ConfluenceUpdateSpaceResponse
> = {
  id: 'confluence_update_space',
  name: 'Confluence Update Space',
  description: 'Update an existing Confluence space (name, description, or status).',
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
      description: 'The ID of the space to update',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status for the space (current or archived)',
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
    url: () => '/api/tools/confluence/spaces',
    method: 'PUT',
    headers: (params: ConfluenceUpdateSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdateSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      name: params.name,
      description: params.description,
      status: params.status,
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        id: data.id ?? '',
        key: data.key ?? '',
        name: data.name ?? '',
        type: data.type ?? '',
        status: data.status ?? '',
        updated: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'ID of the updated space' },
    key: { type: 'string', description: 'Key of the updated space' },
    name: { type: 'string', description: 'Name of the updated space' },
    type: { type: 'string', description: 'Type of the space' },
    status: { type: 'string', description: 'Status of the space' },
    updated: { type: 'boolean', description: 'Update status' },
  },
}
