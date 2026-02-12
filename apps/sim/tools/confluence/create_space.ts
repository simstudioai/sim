import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateSpaceParams {
  accessToken: string
  domain: string
  name: string
  key: string
  description?: string
  cloudId?: string
}

export interface ConfluenceCreateSpaceResponse {
  success: boolean
  output: {
    ts: string
    id: string
    key: string
    name: string
    type: string
    status: string
    homepageId: string | null
  }
}

export const confluenceCreateSpaceTool: ToolConfig<
  ConfluenceCreateSpaceParams,
  ConfluenceCreateSpaceResponse
> = {
  id: 'confluence_create_space',
  name: 'Confluence Create Space',
  description: 'Create a new Confluence space.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new space',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique key for the space (short identifier used in URLs)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the space',
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
    method: 'POST',
    headers: (params: ConfluenceCreateSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreateSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      name: params.name,
      key: params.key,
      description: params.description,
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
        homepageId: data.homepageId ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'ID of the created space' },
    key: { type: 'string', description: 'Key of the created space' },
    name: { type: 'string', description: 'Name of the created space' },
    type: { type: 'string', description: 'Type of the space' },
    status: { type: 'string', description: 'Status of the space' },
    homepageId: { type: 'string', description: 'ID of the space homepage', optional: true },
  },
}
