import type {
  ShopifyCreateProductVariantsParams,
  ShopifyProductVariantsResponse,
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

/** Creates variants for one product and returns validation errors alongside the created variants. */
export const shopifyCreateProductVariantsTool: ToolConfig<
  ShopifyCreateProductVariantsParams,
  ShopifyProductVariantsResponse
> = {
  id: 'shopify_create_product_variants',
  name: 'Shopify Create Product Variants',
  description:
    'Create product variants with pricing, options, inventory attributes, and metafields',
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
        'ProductVariantsBulkInput array (1-250): optionValues for creation, price, compareAtPrice, inventoryItem, taxable, inventoryPolicy, metafields',
    },
    strategy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DEFAULT, REMOVE_STANDALONE_VARIANT, or PRESERVE_STANDALONE_VARIANT',
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
          mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy, $media: [CreateMediaInput!]) {
            productVariantsBulkCreate(
              productId: $productId
              variants: $variants
              strategy: $strategy
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
          strategy: params.strategy || 'DEFAULT',
          media: parseShopifyArray(params.media, 'media'),
        },
      }
    },
  },
  transformResponse: async (response) => {
    const result = await readShopifyResult<{
      productVariants: NonNullable<
        ShopifyProductVariantsResponse['output']['productVariants']
      > | null
      userErrors: ShopifyUserError[]
    }>(response, 'productVariantsBulkCreate')
    return {
      success: result.userErrors.length === 0,
      error: result.userErrors.length
        ? result.userErrors.map((e) => e.message).join(', ')
        : undefined,
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
            nullable: true,
            description: 'Input field path',
            items: { type: 'string' },
          },
          message: { type: 'string', description: 'Validation error' },
        },
      },
    },
  },
}
