import type { ShopifyCustomerResponse, ShopifyGetCustomerParams } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetCustomerTool: ToolConfig<ShopifyGetCustomerParams, ShopifyCustomerResponse> =
  {
    id: 'shopify_get_customer',
    name: 'Shopify Get Customer',
    description: 'Get a single customer by ID from your Shopify store',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'shopify',
    },

    params: {
      shopDomain: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Shopify store domain (e.g., mystore.myshopify.com)',
      },
      customerId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Customer ID (gid://shopify/Customer/123456789)',
      },
    },

    request: {
      url: (params) =>
        `https://${params.shopDomain || params.idToken}/admin/api/2024-10/graphql.json`,
      method: 'POST',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Missing access token for Shopify API request')
        }
        return {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': params.accessToken,
        }
      },
      body: (params) => {
        if (!params.customerId) {
          throw new Error('Customer ID is required')
        }

        return {
          query: `
          query getCustomer($id: ID!) {
            customer(id: $id) {
              id
              email
              firstName
              lastName
              phone
              createdAt
              updatedAt
              note
              tags
              amountSpent {
                amount
                currencyCode
              }
              addresses {
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
              defaultAddress {
                firstName
                lastName
                address1
                address2
                city
                province
                country
                zip
              }
            }
          }
        `,
          variables: {
            id: params.customerId,
          },
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (data.errors) {
        return {
          success: false,
          error: data.errors[0]?.message || 'Failed to get customer',
          output: {},
        }
      }

      const customer = data.data?.customer
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          customer,
        },
      }
    },

    outputs: {
      customer: {
        type: 'object',
        description: 'The customer details',
        properties: CUSTOMER_OUTPUT_PROPERTIES,
      },
    },
  }
