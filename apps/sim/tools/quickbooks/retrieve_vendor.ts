import QuickBooks from 'node-quickbooks'
import type { RetrieveVendorParams, VendorResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRetrieveVendorTool: ToolConfig<RetrieveVendorParams, VendorResponse> = {
  id: 'quickbooks_retrieve_vendor',
  name: 'QuickBooks Retrieve Vendor',
  description: 'Retrieve a specific vendor by ID from QuickBooks Online',
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
    Id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor ID to retrieve',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const vendor = await new Promise<any>((resolve, reject) => {
        qbo.getVendor(params.Id, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          vendor,
          metadata: {
            Id: vendor.Id,
            DisplayName: vendor.DisplayName,
            Balance: vendor.Balance || 0,
            Vendor1099: vendor.Vendor1099 || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_RETRIEVE_VENDOR_ERROR',
          message: error.message || 'Failed to retrieve vendor',
          details: error,
        },
      }
    }
  },

  outputs: {
    vendor: {
      type: 'json',
      description: 'The retrieved QuickBooks vendor object',
    },
    metadata: {
      type: 'json',
      description: 'Vendor summary metadata',
    },
  },
}
