import type { LinearCreateCustomerParams, LinearCreateCustomerResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCustomerTool: ToolConfig<
  LinearCreateCustomerParams,
  LinearCreateCustomerResponse
> = {
  id: 'linear_create_customer',
  name: 'Linear Create Customer',
  description: 'Create a new customer in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer name',
    },
    domains: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domains associated with this customer',
    },
    externalIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'External IDs from other systems',
    },
    logoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Customer's logo URL",
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user who owns this customer',
    },
    revenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annual revenue from this customer',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Size of the customer organization',
    },
    statusId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer status ID',
    },
    tierId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer tier ID',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => {
      const input: Record<string, any> = {
        name: params.name,
      }

      // Optional fields with proper validation
      if (
        params.domains !== undefined &&
        params.domains !== null &&
        Array.isArray(params.domains) &&
        params.domains.length > 0
      ) {
        input.domains = params.domains
      }
      if (
        params.externalIds !== undefined &&
        params.externalIds !== null &&
        Array.isArray(params.externalIds) &&
        params.externalIds.length > 0
      ) {
        input.externalIds = params.externalIds
      }
      if (params.logoUrl !== undefined && params.logoUrl !== null && params.logoUrl !== '') {
        input.logoUrl = params.logoUrl
      }
      if (params.ownerId !== undefined && params.ownerId !== null && params.ownerId !== '') {
        input.ownerId = params.ownerId
      }
      if (params.revenue !== undefined && params.revenue !== null) {
        input.revenue = params.revenue
      }
      if (params.size !== undefined && params.size !== null) {
        input.size = params.size
      }
      if (params.statusId !== undefined && params.statusId !== null && params.statusId !== '') {
        input.statusId = params.statusId
      }
      if (params.tierId !== undefined && params.tierId !== null && params.tierId !== '') {
        input.tierId = params.tierId
      }

      return {
        query: `
          mutation CustomerCreate($input: CustomerCreateInput!) {
            customerCreate(input: $input) {
              success
              customer {
                id
                name
                domains
                externalIds
                logoUrl
                approximateNeedCount
                createdAt
                archivedAt
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

    const result = data.data.customerCreate
    return {
      success: result.success,
      output: {
        customer: result.customer,
      },
    }
  },

  outputs: {
    customer: {
      type: 'object',
      description: 'The created customer',
      properties: {
        id: { type: 'string', description: 'Customer ID' },
        name: { type: 'string', description: 'Customer name' },
        domains: { type: 'array', description: 'Associated domains' },
        externalIds: { type: 'array', description: 'External IDs' },
        logoUrl: { type: 'string', description: 'Logo URL' },
        approximateNeedCount: { type: 'number', description: 'Number of customer needs' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        archivedAt: { type: 'string', description: 'Archive timestamp (null if not archived)' },
      },
    },
  },
}
