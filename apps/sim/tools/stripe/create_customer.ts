import type { CreateCustomerParams, CustomerResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreateCustomerTool: ToolConfig<CreateCustomerParams, CustomerResponse> = {
  id: 'stripe_create_customer',
  name: 'Stripe Create Customer',
  description: 'Create a new customer object',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer email address',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer full name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer phone number',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the customer',
    },
    address: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer address object',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID to attach',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/customers',
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
      if (params.payment_method) formData.append('payment_method', params.payment_method)

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
      description: 'The created customer object',
    },
    metadata: {
      type: 'json',
      description: 'Customer metadata',
    },
  },
}
