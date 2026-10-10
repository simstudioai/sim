import type { ShopifyCreateCustomerParams, ShopifyCustomerResponse } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
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
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
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
      if (params.addresses !== undefined) {
        input.addresses = parseShopifyArray(params.addresses, 'addresses')
      }

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
        error: data.errors?.[0]?.message || 'Failed to create customer',
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
