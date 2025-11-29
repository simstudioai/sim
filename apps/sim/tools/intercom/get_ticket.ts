import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomGetTicket')

export interface IntercomGetTicketParams {
  accessToken: string
  ticketId: string
}

export interface IntercomGetTicketResponse {
  success: boolean
  output: {
    ticket: any
    metadata: {
      operation: 'get_ticket'
    }
    success: boolean
  }
}

export const intercomGetTicketTool: ToolConfig<IntercomGetTicketParams, IntercomGetTicketResponse> =
  {
    id: 'intercom_get_ticket',
    name: 'Get Ticket from Intercom',
    description: 'Retrieve a single ticket by ID from Intercom',
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Intercom API access token',
      },
      ticketId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Ticket ID to retrieve',
      },
    },

    request: {
      url: (params) => buildIntercomUrl(`/tickets/${params.ticketId}`),
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': '2.14',
      }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handleIntercomError(data, response.status, 'get_ticket')
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          ticket: data,
          metadata: {
            operation: 'get_ticket' as const,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Ticket data',
        properties: {
          ticket: { type: 'object', description: 'Ticket object' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
