import { Client } from '@freshbooks/api'
import type { CreateClientParams, CreateClientResponse } from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'

/**
 * FreshBooks Create Client Tool
 * Uses official @freshbooks/api SDK for type-safe client creation
 */
export const freshbooksCreateClientTool: ToolConfig<
  CreateClientParams,
  CreateClientResponse
> = {
  id: 'freshbooks_create_client',
  name: 'FreshBooks Create Client',
  description: 'Create new clients in FreshBooks with contact and billing information',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FreshBooks OAuth access token',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'FreshBooks account ID',
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Client first name',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Client last name',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Client email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client phone number',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client company name',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency code (default: "USD")',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal notes about the client',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api Client
   * Creates client with full contact and billing information
   */
  directExecution: async (params) => {
    try {
      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Prepare client data
      const clientData = {
        fname: params.firstName,
        lname: params.lastName,
        email: params.email,
        organization: params.companyName || `${params.firstName} ${params.lastName}`,
        currency_code: params.currencyCode || 'USD',
        ...(params.phone && { mobile_phone: params.phone }),
        ...(params.notes && { note: params.notes }),
      }

      // Create client using SDK
      const response = await client.clients.create(params.accountId, clientData)
      const createdClient = response.data

      return {
        success: true,
        output: {
          client: {
            id: createdClient.id,
            organization: createdClient.organization,
            fname: createdClient.fname,
            lname: createdClient.lname,
            email: createdClient.email,
            company_name: params.companyName,
            currency_code: createdClient.currency_code,
          },
          metadata: {
            client_id: createdClient.id,
            email: createdClient.email,
            created_at: new Date().toISOString().split('T')[0],
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'FRESHBOOKS_CLIENT_ERROR',
          message: error.message || 'Failed to create FreshBooks client',
          details: error.response?.data || error,
        },
      }
    }
  },

  outputs: {
    client: {
      type: 'json',
      description: 'Created client with ID and contact information',
    },
    metadata: {
      type: 'json',
      description: 'Client metadata for tracking',
    },
  },
}
