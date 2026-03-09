import type { LinearGetCustomerParams, LinearGetCustomerResponse } from '@/tools/linear/types'
import { CUSTOMER_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearGetCustomerTool: ToolConfig<LinearGetCustomerParams, LinearGetCustomerResponse> =
  {
    id: 'linear_get_customer',
    name: 'Linear Get Customer',
    description: 'Get a single customer by ID in Linear',
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
        description: 'Customer ID to retrieve',
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
      body: (params) => ({
        query: `
        query GetCustomer($id: String!) {
          customer(id: $id) {
            id
            name
            domains
            externalIds
            logoUrl
            slugId
            approximateNeedCount
            revenue
            size
            createdAt
            updatedAt
            archivedAt
          }
        }
      `,
        variables: {
          id: params.customerId,
        },
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (data.errors) {
        return {
          success: false,
          error: data.errors[0]?.message || 'Failed to get customer',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          customer: data.data.customer,
        },
      }
    },

    outputs: {
      customer: {
        type: 'object',
        description: 'The customer data',
        properties: CUSTOMER_OUTPUT_PROPERTIES,
      },
    },
  }
