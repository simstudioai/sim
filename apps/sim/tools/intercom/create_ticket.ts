import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomCreateTicket')

export interface IntercomCreateTicketParams {
  accessToken: string
  ticket_type_id: string
  contacts: string
  ticket_attributes: string
}

export interface IntercomCreateTicketResponse {
  success: boolean
  output: {
    ticket: any
    metadata: {
      operation: 'create_ticket'
      ticketId: string
    }
    success: boolean
  }
}

export const intercomCreateTicketTool: ToolConfig<
  IntercomCreateTicketParams,
  IntercomCreateTicketResponse
> = {
  id: 'intercom_create_ticket',
  name: 'Create Ticket in Intercom',
  description: 'Create a new ticket in Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    ticket_type_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the ticket type',
    },
    contacts: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON array of contact identifiers (e.g., [{"id": "contact_id"}])',
    },
    ticket_attributes: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'JSON object with ticket attributes including _default_title_ and _default_description_',
    },
  },

  request: {
    url: () => buildIntercomUrl('/tickets'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const ticket: any = {
        ticket_type_id: params.ticket_type_id,
      }

      try {
        ticket.contacts = JSON.parse(params.contacts)
      } catch (error) {
        logger.warn('Failed to parse contacts, using as single contact ID', { error })
        ticket.contacts = [{ id: params.contacts }]
      }

      try {
        ticket.ticket_attributes = JSON.parse(params.ticket_attributes)
      } catch (error) {
        logger.error('Failed to parse ticket attributes', { error })
        throw new Error('ticket_attributes must be a valid JSON object')
      }

      return ticket
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_ticket')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ticket: data,
        metadata: {
          operation: 'create_ticket' as const,
          ticketId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created ticket data',
      properties: {
        ticket: { type: 'object', description: 'Created ticket object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
