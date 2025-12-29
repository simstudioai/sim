import QuickBooks from 'node-quickbooks'
import type { CreateVendorParams, VendorResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateVendorTool: ToolConfig<CreateVendorParams, VendorResponse> = {
  id: 'quickbooks_create_vendor',
  name: 'QuickBooks Create Vendor',
  description: 'Create a new vendor in QuickBooks Online',
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
      description: 'Vendor display name',
    },
    CompanyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vendor company name',
    },
    GivenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the vendor contact',
    },
    FamilyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the vendor contact',
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
      description: 'Primary email: { Address: "vendor@example.com" }',
    },
    BillAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing address object',
    },
    Vendor1099: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this vendor is eligible for 1099 reporting',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const vendor: Record<string, any> = {
        DisplayName: params.DisplayName,
      }

      if (params.CompanyName) vendor.CompanyName = params.CompanyName
      if (params.GivenName) vendor.GivenName = params.GivenName
      if (params.FamilyName) vendor.FamilyName = params.FamilyName
      if (params.PrimaryPhone) vendor.PrimaryPhone = params.PrimaryPhone
      if (params.PrimaryEmailAddr) vendor.PrimaryEmailAddr = params.PrimaryEmailAddr
      if (params.BillAddr) vendor.BillAddr = params.BillAddr
      if (params.Vendor1099 !== undefined) vendor.Vendor1099 = params.Vendor1099

      const createdVendor = await new Promise<any>((resolve, reject) => {
        qbo.createVendor(vendor, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          vendor: createdVendor,
          metadata: {
            Id: createdVendor.Id,
            DisplayName: createdVendor.DisplayName,
            Balance: createdVendor.Balance || 0,
            Vendor1099: createdVendor.Vendor1099 || false,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_CREATE_VENDOR_ERROR: Failed to create vendor - ${errorDetails}`,
      }
    }
  },

  outputs: {
    vendor: {
      type: 'json',
      description: 'The created QuickBooks vendor object',
    },
    metadata: {
      type: 'json',
      description: 'Vendor summary metadata',
    },
  },
}
