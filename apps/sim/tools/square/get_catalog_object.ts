import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CatalogObjectResponse, GetCatalogObjectParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
  CATALOG_OBJECT_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetCatalogObjectTool: ToolConfig<GetCatalogObjectParams, CatalogObjectResponse> =
  {
    id: 'square_get_catalog_object',
    name: 'Square Get Catalog Object',
    description: 'Retrieve a single catalog object by its ID',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Square access token (personal access token)',
      },
      objectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the catalog object to retrieve',
      },
      includeRelatedObjects: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to include related objects such as an item variations',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(
          `${SQUARE_BASE_URL}/v2/catalog/object/${encodeURIComponent(params.objectId)}`
        )
        if (params.includeRelatedObjects !== undefined) {
          url.searchParams.append('include_related_objects', String(params.includeRelatedObjects))
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => squareHeaders(params.apiKey),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const object = data.object ?? {}
      return {
        success: true,
        output: {
          object,
          metadata: {
            id: object.id,
            type: object.type ?? null,
            version: object.version ?? null,
          },
        },
      }
    },

    outputs: {
      object: { ...CATALOG_OBJECT_OUTPUT, description: 'The retrieved catalog object' },
      metadata: {
        type: 'json',
        description: 'Catalog object summary metadata',
        properties: CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
      },
    },
  }
