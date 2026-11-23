import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CatalogDeleteResponse, DeleteCatalogObjectParams } from '@/tools/square/types'
import { SQUARE_ENVIRONMENTS, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareDeleteCatalogObjectTool: ToolConfig<
  DeleteCatalogObjectParams,
  CatalogDeleteResponse
> = {
  id: 'square_delete_catalog_object',
  name: 'Square Delete Catalog Object',
  description: 'Delete a catalog object and its children (e.g. an item and its variations)',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
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
      description: 'ID of the catalog object to delete',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/catalog/object/${encodeURIComponent(params.objectId)}`,
    method: 'DELETE',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        deleted: true,
        deleted_object_ids: data.deleted_object_ids ?? [],
        deleted_at: data.deleted_at ?? null,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the catalog object was deleted' },
    deleted_object_ids: {
      type: 'array',
      description: 'IDs of all catalog objects deleted (including children)',
      items: { type: 'string' },
    },
    deleted_at: {
      type: 'string',
      description: 'Timestamp when the deletion occurred (RFC 3339)',
      optional: true,
    },
  },
}
