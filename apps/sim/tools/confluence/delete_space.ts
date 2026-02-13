import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeleteSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  cloudId?: string
}

export interface ConfluenceDeleteSpaceResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    deleted: boolean
  }
}

export const confluenceDeleteSpaceTool: ToolConfig<
  ConfluenceDeleteSpaceParams,
  ConfluenceDeleteSpaceResponse
> = {
  id: 'confluence_delete_space',
  name: 'Confluence Delete Space',
  description: 'Delete a Confluence space by its ID.',
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
      description: 'The ID of the space to delete',
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
    method: 'DELETE',
    headers: (params: ConfluenceDeleteSpaceParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceDeleteSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
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
        deleted: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'ID of the deleted space' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
