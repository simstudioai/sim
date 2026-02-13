import type {
  ConfluenceUpdatePagePropertyParams,
  ConfluenceUpdatePagePropertyResponse,
} from '@/tools/confluence/types'
import { PAGE_PROPERTY_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export const confluenceUpdatePagePropertyTool: ToolConfig<
  ConfluenceUpdatePagePropertyParams,
  ConfluenceUpdatePagePropertyResponse
> = {
  id: 'confluence_update_page_property',
  name: 'Confluence Update Page Property',
  description: 'Update an existing content property on a Confluence page.',
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
      description: 'The ID of the property to update',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key/name of the property',
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
      description: 'The current version number of the property (for conflict prevention)',
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
    method: 'PUT',
    headers: (params: ConfluenceUpdatePagePropertyParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdatePagePropertyParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      propertyId: params.propertyId?.trim(),
      key: params.key,
      value: params.value,
      versionNumber: Number(params.versionNumber),
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
    propertyId: { type: 'string', description: 'ID of the updated property' },
    ...PAGE_PROPERTY_ITEM_PROPERTIES,
  },
}
