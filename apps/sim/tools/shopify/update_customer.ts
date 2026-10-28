import type { ShopifyCustomerResponse, ShopifyUpdateCustomerParams } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateCustomerTool: ToolConfig<
  ShopifyUpdateCustomerParams,
  ShopifyCustomerResponse
> = {
  id: 'shopify_update_customer',
  name: 'Shopify Update Customer',
  description: 'Update an existing customer in your Shopify store',
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
    addresses: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'MailingAddressInput array; replacing addresses is deprecated by Shopify',
    },
    locale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer locale, such as en',
    },
    taxExempt: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the customer is exempt from taxes',
    },
    metafields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'MetafieldInput array: namespace, key, type, value, or id',
    },
    emailMarketingConsent: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CustomerEmailMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
    },
    smsMarketingConsent: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CustomerSmsMarketingConsentInput with marketingState, marketingOptInLevel, consentUpdatedAt',
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
      description: 'Customer ID to update (gid://shopify/Customer/123456789)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer email address',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer last name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer phone number',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New note about the customer',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer tags',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.customerId?.trim()) {
        throw new Error('Customer ID is required to update a customer')
      }

      const input: Record<string, unknown> = {
        id: params.customerId.trim(),
      }

      if (params.email !== undefined) {
        input.email = params.email
      }
      if (params.firstName !== undefined) {
        input.firstName = params.firstName
      }
      if (params.lastName !== undefined) {
        input.lastName = params.lastName
      }
      if (params.phone !== undefined) {
        input.phone = params.phone
      }
      if (params.note !== undefined) {
        input.note = params.note
      }
      if (params.tags !== undefined) {
        input.tags = params.tags
      }

      if (params.addresses !== undefined)
        input.addresses = parseShopifyArray(params.addresses, 'addresses')
      if (params.locale !== undefined) input.locale = params.locale
      if (params.taxExempt !== undefined) input.taxExempt = params.taxExempt
      if (params.metafields !== undefined)
        input.metafields = parseShopifyArray(params.metafields, 'metafields')
      if (params.emailMarketingConsent !== undefined)
        input.emailMarketingConsent = parseShopifyObject(
          params.emailMarketingConsent,
          'emailMarketingConsent'
        )
      if (params.smsMarketingConsent !== undefined)
        input.smsMarketingConsent = parseShopifyObject(
          params.smsMarketingConsent,
          'smsMarketingConsent'
        )

      return {
        query: `
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
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
        error: data.errors?.[0]?.message || 'Failed to update customer',
        output: {},
      }
    }

    const result = data.data?.customerUpdate
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
        error: 'Customer update was not successful',
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
      description: 'The updated customer',
      properties: CUSTOMER_OUTPUT_PROPERTIES,
    },
  },
}
