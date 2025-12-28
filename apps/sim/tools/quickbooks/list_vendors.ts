import QuickBooks from 'node-quickbooks'
import type { ListVendorsParams, ListVendorsResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksListVendorsTool: ToolConfig<ListVendorsParams, ListVendorsResponse> = {
  id: 'quickbooks_list_vendors',
  name: 'QuickBooks List Vendors',
  description: 'Query and list vendors in QuickBooks Online',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SQL-like query string (e.g., "SELECT * FROM Vendor WHERE Active = true")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 100)',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting position for pagination (default: 1)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const query = params.query || 'SELECT * FROM Vendor'
      const vendors = await new Promise<any[]>((resolve, reject) => {
        qbo.findVendors(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Vendor || [])
        })
      })

      return {
        success: true,
        output: {
          vendors,
          metadata: {
            count: vendors.length,
            startPosition: params.startPosition || 1,
            maxResults: params.maxResults || 100,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_LIST_VENDORS_ERROR',
          message: error.message || 'Failed to list vendors',
          details: error,
        },
      }
    }
  },

  outputs: {
    vendors: {
      type: 'json',
      description: 'Array of QuickBooks vendor objects',
    },
    metadata: {
      type: 'json',
      description: 'Query metadata including count and pagination info',
    },
  },
}
