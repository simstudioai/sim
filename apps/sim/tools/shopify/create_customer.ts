import type { ShopifyCreateCustomerParams, ShopifyCustomerResponse } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyCreateCustomerTool: ToolConfig<
  ShopifyCreateCustomerParams,
  ShopifyCustomerResponse
> = {
  id: 'shopify_create_customer',
  name: 'Shopify Create Customer',
  description: 'Create a new customer in your Shopify store',
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
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer email address',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer last name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer phone number',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Note about the customer',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer tags',
    },
    addresses: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer addresses',
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
      // Shopify requires at least one of: email, phone, firstName, or lastName
      const hasEmail = params.email?.trim()
      const hasPhone = params.phone?.trim()
      const hasFirstName = params.firstName?.trim()
      const hasLastName = params.lastName?.trim()

      if (!hasEmail && !hasPhone && !hasFirstName && !hasLastName) {
        throw new Error('Customer must have at least one of: email, phone, firstName, or lastName')
      }

      const input: Record<string, unknown> = {}

      if (hasEmail) {
        input.email = params.email
      }
      if (hasFirstName) {
        input.firstName = params.firstName
      }
      if (hasLastName) {
        input.lastName = params.lastName
      }
      if (hasPhone) {
        input.phone = params.phone
      }
      if (params.note) {
        input.note = params.note
      }
      if (params.tags && Array.isArray(params.tags)) {
        input.tags = params.tags
      }
      if (params.addresses && Array.isArray(params.addresses)) {
        input.addresses = params.addresses
      }

      return {
        query: `
          mutation customerCreate($input: CustomerInput!) {
            customerCreate(input: $input) {
              customer {
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
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                defaultAddress {
                  address1
                  city
                  province
                  country
                  zip
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

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create customer',
        output: {},
      }
    }

    const result = data.data?.customerCreate
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const customer = result?.customer
    if (!customer) {
      return {
        success: false,
        error: 'Customer creation was not successful',
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
      description: 'The created customer',
      properties: CUSTOMER_OUTPUT_PROPERTIES,
    },
  },
}
