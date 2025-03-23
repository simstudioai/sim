import { ToolConfig, ToolResponse } from '../types'

export interface GuestyGuestParams {
  apiKey: string
  phoneNumber: string
}

export interface GuestyGuestResponse extends ToolResponse {
  output: {
    guests: Array<{
      id: string
      fullName: string
      email: string
      phone: string
      address: string
      city: string
      country: string
    }>
  }
}

export const guestyGuestTool: ToolConfig<GuestyGuestParams, GuestyGuestResponse> = {
  id: 'guesty_guest',
  name: 'Guesty Guest',
  description: 'Search for guests in Guesty by phone number',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Guesty API token',
    },
    phoneNumber: {
      type: 'string',
      required: true,
      description: 'The phone number to search for',
    },
  },

  request: {
    url: 'https://open-api.guesty.com/v1/guests',
    method: 'GET',
    headers: (params: GuestyGuestParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params: GuestyGuestParams) => ({
      filters: {
        phone: params.phoneNumber,
      },
      fields: 'fullName,email,phone,address,city,country',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to search for guests in Guesty')
    }

    return {
      success: true,
      output: {
        guests: data.results.map((guest: any) => ({
          id: guest.id,
          fullName: guest.fullName || 'N/A',
          email: guest.email || 'N/A',
          phone: guest.phone || 'N/A',
          address: guest.address || 'N/A',
          city: guest.city || 'N/A',
          country: guest.country || 'N/A',
        })),
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Failed to search for guests in Guesty'
    return message
  },
}
