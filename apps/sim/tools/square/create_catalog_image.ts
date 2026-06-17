import type { CatalogObjectResponse, CreateCatalogImageParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
  CATALOG_OBJECT_OUTPUT,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCreateCatalogImageTool: ToolConfig<
  CreateCatalogImageParams,
  CatalogObjectResponse
> = {
  id: 'square_create_catalog_image',
  name: 'Square Create Catalog Image',
  description: 'Upload an image and attach it to the catalog, optionally to a specific item',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'The image file to upload (UserFile object)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override for the image',
    },
    objectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the catalog object (e.g. an item) to attach the image to',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Caption (alt text) for the image',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: '/api/tools/square/catalog-image',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.apiKey,
      file: params.file,
      fileName: params.fileName,
      objectId: params.objectId,
      caption: params.caption,
      idempotencyKey: params.idempotencyKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to upload catalog image')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    object: { ...CATALOG_OBJECT_OUTPUT, description: 'The created catalog image object' },
    metadata: {
      type: 'json',
      description: 'Catalog object summary metadata',
      properties: CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
