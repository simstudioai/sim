import {
  INCIDENTIO_CATALOG_TYPE_OUTPUT_PROPERTIES,
  type IncidentioCatalogTypesListParams,
  type IncidentioCatalogTypesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const catalogTypesListTool: ToolConfig<
  IncidentioCatalogTypesListParams,
  IncidentioCatalogTypesListResponse
> = {
  id: 'incidentio_catalog_types_list',
  name: 'List Catalog Types',
  description:
    'List all catalog types in incident.io, including those synced from external resources. Use this to find the catalog type ID needed to list entries.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
  },

  request: {
    url: 'https://api.incident.io/v3/catalog_types',
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        catalog_types: data.catalog_types ?? [],
      },
    }
  },

  outputs: {
    catalog_types: {
      type: 'array',
      description: 'List of catalog types',
      items: {
        type: 'object',
        properties: INCIDENTIO_CATALOG_TYPE_OUTPUT_PROPERTIES,
      },
    },
  },
}
