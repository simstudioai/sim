import type { LinearUpdateCustomerParams, LinearUpdateCustomerResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateCustomerTool: ToolConfig<
  LinearUpdateCustomerParams,
  LinearUpdateCustomerResponse
> = {
  id: 'linear_update_customer',
  name: 'Linear Update Customer',
  description: 'Update a customer in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated customer name',
    },
    domains: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated domains',
    },
    externalIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated external IDs',
    },
    logoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated logo URL',
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated owner user ID',
    },
    revenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated annual revenue',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated organization size',
    },
    statusId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated customer status ID',
    },
    tierId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated customer tier ID',
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
      const input: Record<string, any> = {}

      if (params.name !== undefined && params.name !== null && params.name !== '') {
        input.name = params.name
      }
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
          mutation CustomerUpdate($id: String!, $input: CustomerUpdateInput!) {
            customerUpdate(id: $id, input: $input) {
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
          id: params.customerId,
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
        error: data.errors[0]?.message || 'Failed to update customer',
        output: {},
      }
    }

    const result = data.data.customerUpdate
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
      description: 'The updated customer',
    },
  },
}
