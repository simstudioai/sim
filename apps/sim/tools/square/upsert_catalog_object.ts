import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CatalogObjectResponse, UpsertCatalogObjectParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
  CATALOG_OBJECT_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareUpsertCatalogObjectTool: ToolConfig<
  UpsertCatalogObjectParams,
  CatalogObjectResponse
> = {
  id: 'square_upsert_catalog_object',
  name: 'Square Upsert Catalog Object',
  description: 'Create or update a catalog object such as an item, variation, or category',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    object: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Square catalog object to create or update. Use ID "#name" for new objects (e.g. {"type":"ITEM","id":"#Coffee","item_data":{"name":"Coffee"}})',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/catalog/object`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => ({
      idempotency_key: params.idempotencyKey || generateId(),
      object: params.object,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const object = data.catalog_object ?? {}
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
    object: { ...CATALOG_OBJECT_OUTPUT, description: 'The created or updated catalog object' },
    metadata: {
      type: 'json',
      description: 'Catalog object summary metadata',
      properties: CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
