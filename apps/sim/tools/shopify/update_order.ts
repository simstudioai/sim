import type { ShopifyOrderResponse, ShopifyUpdateOrderParams } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateOrderTool: ToolConfig<ShopifyUpdateOrderParams, ShopifyOrderResponse> = {
  id: 'shopify_update_order',
  name: 'Shopify Update Order',
  description: 'Update an existing order in your Shopify store (note, tags, email)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'shopify',
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer phone number for the order',
    },
    shippingAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'MailingAddressInput object with firstName, lastName, address1, address2, city, provinceCode, countryCode, zip, and phone',
    },
    customAttributes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order attributes as an array of {key, value} objects',
    },
    metafields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'MetafieldInput array: namespace, key, type, value, or id',
    },
    poNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase order number',
    },

    shopDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Your Shopify store domain (e.g., mystore.myshopify.com)',
    },
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order ID to update (gid://shopify/Order/123456789)',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New order note',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New order tags',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer email for the order',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.orderId?.trim()) {
        throw new Error('Order ID is required to update an order')
      }

      const input: Record<string, unknown> = {
        id: params.orderId.trim(),
      }

      if (params.note !== undefined) {
        input.note = params.note
      }
      if (params.tags !== undefined) {
        input.tags = params.tags
      }
      if (params.email !== undefined) {
        input.email = params.email
      }

      if (params.phone !== undefined) input.phone = params.phone
      if (params.shippingAddress !== undefined)
        input.shippingAddress = parseShopifyObject(params.shippingAddress, 'shippingAddress')
      if (params.customAttributes !== undefined)
        input.customAttributes = parseShopifyArray(params.customAttributes, 'customAttributes')
      if (params.metafields !== undefined)
        input.metafields = parseShopifyArray(params.metafields, 'metafields')
      if (params.poNumber !== undefined) input.poNumber = params.poNumber

      return {
        query: `
          mutation orderUpdate($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                name
                email
                phone
                createdAt
                updatedAt
                cancelledAt
                closedAt
                displayFinancialStatus
                displayFulfillmentStatus
                poNumber
                customAttributes {
                  key
                  value
                }
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
                subtotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
                note
                tags
                customer {
                  id
                  email
                  firstName
                  lastName
                  phone
                }
                lineItems(first: 10) {
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                  edges {
                    node {
                      id
                      title
                      quantity
                      variant {
                        id
                        title
                        price
                        compareAtPrice
                        inventoryQuantity
                        sku
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
                      originalTotalSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                        presentmentMoney {
                          amount
                          currencyCode
                        }
                      }
                      discountedTotalSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                        presentmentMoney {
                          amount
                          currencyCode
                        }
                      }
                    }
                  }
                }
                shippingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  city
                  province
                  provinceCode
                  country
                  countryCode
                  zip
                  phone
                }
                billingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  city
                  province
                  provinceCode
                  country
                  countryCode
                  zip
                  phone
                }
                fulfillments {
                  id
                  status
                  createdAt
                  updatedAt
                  trackingInfo {
                    company
                    number
                    url
                  }
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
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to update order',
        output: {},
      }
    }

    const result = data.data?.orderUpdate
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const order = result?.order
    if (!order) {
      return {
        success: false,
        error: 'Order update was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        order,
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description: 'The updated order',
      properties: ORDER_OUTPUT_PROPERTIES,
    },
  },
}
