import QuickBooks from 'node-quickbooks'
import type { CustomerResponse, RetrieveCustomerParams } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRetrieveCustomerTool: ToolConfig<RetrieveCustomerParams, CustomerResponse> =
  {
    id: 'quickbooks_retrieve_customer',
    name: 'QuickBooks Retrieve Customer',
    description: 'Retrieve a specific customer from QuickBooks Online',
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
        description: 'Customer ID to retrieve',
      },
    },

    directExecution: async (params) => {
      try {
        const qbo = new QuickBooks(
          '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
        )

        const customer = await new Promise<any>((resolve, reject) => {
          qbo.getCustomer(params.Id, (err: any, result: any) => {
            if (err) reject(err)
            else resolve(result)
          })
        })

        return {
          success: true,
          output: {
            customer,
            metadata: {
              Id: customer.Id,
              DisplayName: customer.DisplayName,
              Balance: customer.Balance || 0,
            },
          },
        }
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'QUICKBOOKS_RETRIEVE_CUSTOMER_ERROR',
            message: error.message || 'Failed to retrieve customer',
            details: error,
          },
        }
      }
    },

    outputs: {
      customer: {
        type: 'json',
        description: 'The retrieved QuickBooks customer object',
      },
      metadata: {
        type: 'json',
        description: 'Customer summary metadata',
      },
    },
  }
