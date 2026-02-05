import { TIMESTAMP_OUTPUT, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreatePagePropertyParams {
  accessToken: string
  domain: string
  pageId: string
  key: string
  value: any
  cloudId?: string
}

export interface ConfluenceCreatePagePropertyResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    propertyId: string
    key: string
    value: any
    version: {
      number: number
    } | null
  }
}

export const confluenceCreatePagePropertyTool: ToolConfig<
  ConfluenceCreatePagePropertyParams,
  ConfluenceCreatePagePropertyResponse
> = {
  id: 'confluence_create_page_property',
  name: 'Confluence Create Page Property',
  description: 'Create a new custom property (metadata) on a Confluence page.',
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
      description: 'The ID of the page to add the property to',
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
    url: () => '/api/tools/confluence/page-properties',
    method: 'POST',
    headers: (params: ConfluenceCreatePagePropertyParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreatePagePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
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
        pageId: data.pageId ?? '',
        propertyId: data.id ?? '',
        key: data.key ?? '',
        value: data.value ?? null,
        version: data.version ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page' },
    propertyId: { type: 'string', description: 'ID of the created property' },
    key: { type: 'string', description: 'Property key' },
    value: { type: 'json', description: 'Property value' },
    version: {
      type: 'object',
      description: 'Version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
  },
}
