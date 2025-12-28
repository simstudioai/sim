import QuickBooks from 'node-quickbooks'
import type { CreateCustomerParams, CustomerResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateCustomerTool: ToolConfig<CreateCustomerParams, CustomerResponse> = {
  id: 'quickbooks_create_customer',
  name: 'QuickBooks Create Customer',
  description: 'Create a new customer in QuickBooks Online',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID (realm ID)',
    },
    DisplayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the customer (must be unique)',
    },
    CompanyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    GivenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    FamilyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    PrimaryPhone: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary phone: { FreeFormNumber: "555-1234" }',
    },
    PrimaryEmailAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary email: { Address: "customer@example.com" }',
    },
    BillAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing address object',
    },
    ShipAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shipping address object',
    },
    Taxable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether customer is taxable',
    },
    PreferredDeliveryMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred delivery method (e.g., "Email", "Print")',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', // consumerKey (not needed for OAuth2)
        '', // consumerSecret (not needed for OAuth2)
        params.apiKey, // accessToken
        '', // accessTokenSecret (not needed for OAuth2)
        params.realmId,
        false, // useSandbox
        false, // debug
        70, // minorVersion
        '2.0', // oauthVersion
        null // refreshToken
      )

      const customer: Record<string, any> = {
        DisplayName: params.DisplayName,
      }

      if (params.CompanyName) customer.CompanyName = params.CompanyName
      if (params.GivenName) customer.GivenName = params.GivenName
      if (params.FamilyName) customer.FamilyName = params.FamilyName
      if (params.PrimaryPhone) customer.PrimaryPhone = params.PrimaryPhone
      if (params.PrimaryEmailAddr) customer.PrimaryEmailAddr = params.PrimaryEmailAddr
      if (params.BillAddr) customer.BillAddr = params.BillAddr
      if (params.ShipAddr) customer.ShipAddr = params.ShipAddr
      if (params.Taxable !== undefined) customer.Taxable = params.Taxable
      if (params.PreferredDeliveryMethod)
        customer.PreferredDeliveryMethod = params.PreferredDeliveryMethod

      // Promisify the callback-based SDK method
      const createdCustomer = await new Promise<any>((resolve, reject) => {
        qbo.createCustomer(customer, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          customer: createdCustomer,
          metadata: {
            Id: createdCustomer.Id,
            DisplayName: createdCustomer.DisplayName,
            Balance: createdCustomer.Balance || 0,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CREATE_CUSTOMER_ERROR',
          message: error.message || 'Failed to create customer',
          details: error,
        },
      }
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The created QuickBooks customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer summary metadata',
    },
  },
}
