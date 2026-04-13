import { SPACE_DESCRIPTION_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
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
    spaceId: string
    name: string
    key: string
    type: string
    status: string
    url: string
    homepageId: string | null
    description: { value: string; representation: string } | null
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
      description: 'Unique key for the space (uppercase, no spaces)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the new space',
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
    method: 'POST',
    headers: (params: ConfluenceCreateSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreateSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      name: params.name,
      key: params.key,
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
        homepageId: data.homepageId ?? null,
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'Created space ID' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space type' },
    status: { type: 'string', description: 'Space status' },
    url: { type: 'string', description: 'URL to view the space' },
    homepageId: { type: 'string', description: 'Homepage ID', optional: true },
    description: {
      type: 'object',
      description: 'Space description',
      properties: SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
      optional: true,
    },
  },
}
