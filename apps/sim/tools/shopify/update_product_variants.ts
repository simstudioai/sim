import type {
  ShopifyProductVariantsResponse,
  ShopifyUpdateProductVariantsParams,
  ShopifyUserError,
} from '@/tools/shopify/types'
import { VARIANT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  readShopifyResult,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateProductVariantsTool: ToolConfig<
  ShopifyUpdateProductVariantsParams,
  ShopifyProductVariantsResponse
> = {
  id: 'shopify_update_product_variants',
  name: 'Shopify Update Product Variants',
  description:
    'Update product variants with pricing, options, inventory attributes, and metafields',
  version: '1.0.0',
  oauth: { required: true, provider: 'shopify', authoritativeParams: ['domain', 'idToken'] },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    shopDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Shop domain supplied by the connected credential (store.myshopify.com)',
    },
    productId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product GID',
    },
    variants: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ProductVariantsBulkInput array (1-250): id for updates, price, compareAtPrice, inventoryItem, optionValues, taxable, inventoryPolicy, metafields',
    },
    allowPartialUpdates: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow valid variants to update even if other variants fail',
    },
    media: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'CreateMediaInput array with originalSource, mediaContentType, and alt',
    },
  },
  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.productId?.trim()) throw new Error('Product ID is required')
      const variants = parseShopifyArray(params.variants, 'variants')
      if (!variants?.length) throw new Error('Provide 1-250 variants')
      return {
        query: `
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartialUpdates: Boolean, $media: [CreateMediaInput!]) {
            productVariantsBulkUpdate(
              productId: $productId
              variants: $variants
              allowPartialUpdates: $allowPartialUpdates
              media: $media
            ) {
              productVariants {
                id
                title
                price
                compareAtPrice
                sku
                inventoryQuantity
                barcode
                taxable
                inventoryPolicy
                inventoryItem {
                  id
                  sku
                  tracked
                }
                selectedOptions {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }

        `,
        variables: {
          productId: params.productId.trim(),
          variants,
          allowPartialUpdates: params.allowPartialUpdates ?? false,
          media: parseShopifyArray(params.media, 'media'),
        },
      }
    },
  },
  transformResponse: async (response, params) => {
    const result = await readShopifyResult<{
      productVariants: NonNullable<
        ShopifyProductVariantsResponse['output']['productVariants']
      > | null
      userErrors: ShopifyUserError[]
    }>(response, 'productVariantsBulkUpdate')
    const success =
      result.userErrors.length === 0 ||
      (params?.allowPartialUpdates === true && (result.productVariants?.length ?? 0) > 0)
    return {
      success,
      error: !success ? result.userErrors.map((e) => e.message).join(', ') : undefined,
      output: { productVariants: result.productVariants ?? [], userErrors: result.userErrors },
    }
  },
  outputs: {
    productVariants: {
      type: 'array',
      description: 'Variants successfully created or updated',
      items: { type: 'object', properties: VARIANT_PROPERTIES },
    },
    userErrors: {
      type: 'array',
      description: 'Validation errors, including partial update failures',
      items: {
        type: 'object',
        properties: {
          field: {
            type: 'array',
            optional: true,
            description: 'Input field path',
            items: { type: 'string' },
          },
          message: { type: 'string', description: 'Validation error' },
        },
      },
    },
  },
}
