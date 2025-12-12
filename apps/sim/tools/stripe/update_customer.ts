import type { CustomerResponse, UpdateCustomerParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeUpdateCustomerTool: ToolConfig<UpdateCustomerParams, CustomerResponse> = {
  id: 'stripe_update_customer',
  name: 'Stripe Update Customer',
  description: 'Update an existing customer',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID (e.g., cus_1234567890)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated email address',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated phone number',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    address: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated address object',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/customers/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.email) formData.append('email', params.email)
      if (params.name) formData.append('name', params.name)
      if (params.phone) formData.append('phone', params.phone)
      if (params.description) formData.append('description', params.description)

      if (params.address) {
        Object.entries(params.address).forEach(([key, value]) => {
          if (value) formData.append(`address[${key}]`, String(value))
        })
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        customer: data,
        metadata: {
          id: data.id,
          email: data.email,
          name: data.name,
        },
      },
    }
  },

  outputs: {
    customer: {
      type: 'json',
      description: 'The updated customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
