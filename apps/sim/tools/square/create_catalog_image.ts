import {
  defineSquareKeyedSite,
  resolveSquareIdempotencyKey,
  type SquareDeliveryContextParams,
} from '@/tools/square/idempotency'
import type { CatalogObjectResponse, CreateCatalogImageParams } from '@/tools/square/types'
import {
  CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES,
  CATALOG_OBJECT_OUTPUT,
} from '@/tools/square/types'
import type { InternalToolConfig } from '@/tools/types'

const DELIVERY = defineSquareKeyedSite(
  'square_create_catalog_image',
  "a second copy of the image would appear in the seller's catalog"
)

export const squareCreateCatalogImageTool: InternalToolConfig<
  CreateCatalogImageParams & SquareDeliveryContextParams,
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

  operation: {
    /**
     * The token is resolved here rather than in the proxy route because the
     * execution identity it derives from only exists on this side. The route
     * assembles Square's multipart body and places the value it is given at
     * `idempotency_key`.
     */
    input: (params) => ({
      accessToken: params.apiKey,
      file: params.file,
      fileName: params.fileName,
      objectId: params.objectId,
      caption: params.caption,
      idempotencyKey: resolveSquareIdempotencyKey(DELIVERY, params),
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
