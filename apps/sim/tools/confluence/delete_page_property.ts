import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeletePagePropertyParams {
  accessToken: string
  domain: string
  pageId: string
  propertyId: string
  cloudId?: string
}

export interface ConfluenceDeletePagePropertyResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    propertyId: string
    deleted: boolean
  }
}

export const confluenceDeletePagePropertyTool: ToolConfig<
  ConfluenceDeletePagePropertyParams,
  ConfluenceDeletePagePropertyResponse
> = {
  id: 'confluence_delete_page_property',
  name: 'Confluence Delete Page Property',
  description: 'Delete a content property from a Confluence page by its property ID.',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the page containing the property',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the property to delete',
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
    url: () => '/api/tools/confluence/page-properties',
    method: 'DELETE',
    headers: (params: ConfluenceDeletePagePropertyParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceDeletePagePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      propertyId: params.propertyId?.trim(),
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.pageId ?? '',
        propertyId: data.propertyId ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page' },
    propertyId: { type: 'string', description: 'ID of the deleted property' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
