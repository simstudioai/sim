import type {
  LinearUpdateCustomerRequestParams,
  LinearUpdateCustomerRequestResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateCustomerRequestTool: ToolConfig<
  LinearUpdateCustomerRequestParams,
  LinearUpdateCustomerRequestResponse
> = {
  id: 'linear_update_customer_request',
  name: 'Linear Update Customer Request',
  description:
    'Update a customer request (need) in Linear. Can change urgency, description, customer assignment, and linked issue.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    customerNeedId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer request ID to update',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description of the customer request',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated urgency level: 0 = Not important, 1 = Important',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer ID to assign this request to',
    },
    issueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New issue ID to link this request to',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project ID to link this request to',
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

      // Optional fields with proper validation
      if (params.body !== undefined && params.body !== null && params.body !== '') {
        input.body = params.body
      }
      if (params.priority !== undefined && params.priority !== null) {
        input.priority = params.priority
      }
      if (
        params.customerId !== undefined &&
        params.customerId !== null &&
        params.customerId !== ''
      ) {
        input.customerId = params.customerId
      }
      if (params.issueId !== undefined && params.issueId !== null && params.issueId !== '') {
        input.issueId = params.issueId
      }
      if (params.projectId !== undefined && params.projectId !== null && params.projectId !== '') {
        input.projectId = params.projectId
      }

      return {
        query: `
          mutation CustomerNeedUpdate($id: String!, $input: CustomerNeedUpdateInput!) {
            customerNeedUpdate(id: $id, input: $input) {
              success
              need {
                id
                body
                priority
                createdAt
                updatedAt
                archivedAt
                customer {
                  id
                  name
                }
                issue {
                  id
                  title
                }
                project {
                  id
                  name
                }
                creator {
                  id
                  name
                }
                url
              }
            }
          }
        `,
        variables: {
          id: params.customerNeedId,
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
        error: data.errors[0]?.message || 'Failed to update customer request',
        output: {},
      }
    }

    const result = data.data.customerNeedUpdate
    return {
      success: result.success,
      output: {
        customerNeed: result.need,
      },
    }
  },

  outputs: {
    customerNeed: {
      type: 'object',
      description: 'The updated customer request',
      properties: {
        id: { type: 'string', description: 'Customer request ID' },
        body: { type: 'string', description: 'Request description' },
        priority: {
          type: 'number',
          description: 'Urgency level (0 = Not important, 1 = Important)',
        },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
        archivedAt: { type: 'string', description: 'Archive timestamp (null if not archived)' },
        customer: { type: 'object', description: 'Assigned customer' },
        issue: { type: 'object', description: 'Linked issue (null if not linked)' },
        project: { type: 'object', description: 'Linked project (null if not linked)' },
        creator: { type: 'object', description: 'User who created the request' },
        url: { type: 'string', description: 'URL to the customer request' },
      },
    },
  },
}
