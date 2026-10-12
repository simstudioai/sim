import type { ShopifyCustomerResponse, ShopifyGetCustomerParams } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl } from '@/tools/shopify/utils'
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
      authoritativeParams: ['domain', 'idToken'],
    },

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
      url: getShopifyUrl,
      method: 'POST',
      headers: getShopifyHeaders,
      body: (params) => {
        if (!params.customerId?.trim()) {
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
              numberOfOrders
              locale
              taxExempt
              emailMarketingConsent {
                marketingState
                marketingOptInLevel
                consentUpdatedAt
              }
              smsMarketingConsent {
                marketingState
                marketingOptInLevel
                consentUpdatedAt
              }
              amountSpent {
                amount
                currencyCode
              }
              addresses(first: 250) {
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
                provinceCode
                country
                countryCode
                zip
                phone
              }
            }
          }

        `,
          variables: {
            id: params.customerId.trim(),
          },
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!response.ok || data.errors?.length) {
        return {
          success: false,
          error: data.errors?.[0]?.message || 'Failed to get customer',
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
