import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomCreateTicket')

export interface IntercomCreateTicketParams {
  accessToken: string
  ticket_type_id: string
  contacts: string
  ticket_attributes: string
  company_id?: string
  created_at?: number
  conversation_to_link_id?: string
  disable_notifications?: boolean
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

export interface IntercomCreateTicketV2Response {
  success: boolean
  output: {
    ticket: any
    ticketId: string
    success: boolean
  }
}

const createTicketBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    ticket_type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the ticket type',
    },
    contacts: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of contact identifiers (e.g., [{"id": "contact_id"}])',
    },
    ticket_attributes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with ticket attributes including _default_title_ and _default_description_',
    },
    company_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company ID to associate the ticket with',
    },
    created_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp for when the ticket was created. If not provided, current time is used.',
    },
    conversation_to_link_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of an existing conversation to link to this ticket',
    },
    disable_notifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, suppresses notifications when the ticket is created',
    },
  },
  request: {
    url: () => buildIntercomUrl('/tickets'),
    method: 'POST',
    headers: (params: IntercomCreateTicketParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateTicketParams) => {
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

      if (params.company_id) ticket.company_id = params.company_id
      if (params.created_at) ticket.created_at = params.created_at
      if (params.conversation_to_link_id)
        ticket.conversation_to_link_id = params.conversation_to_link_id
      if (params.disable_notifications !== undefined)
        ticket.disable_notifications = params.disable_notifications

      return ticket
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateTicketParams, any>, 'params' | 'request'>

export const intercomCreateTicketTool: ToolConfig<
  IntercomCreateTicketParams,
  IntercomCreateTicketResponse
> = {
  id: 'intercom_create_ticket',
  name: 'Create Ticket in Intercom',
  description: 'Create a new ticket in Intercom',
  version: '1.0.0',

  ...createTicketBase,

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
    ticket: {
      type: 'object',
      description: 'Created ticket object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the ticket' },
        type: { type: 'string', description: 'Object type (ticket)' },
        ticket_id: { type: 'string', description: 'Ticket ID' },
        ticket_type: { type: 'object', description: 'Type of the ticket', optional: true },
        ticket_attributes: { type: 'object', description: 'Attributes of the ticket' },
        ticket_state: { type: 'string', description: 'State of the ticket' },
        ticket_state_internal_label: {
          type: 'string',
          description: 'Internal label for ticket state',
        },
        ticket_state_external_label: {
          type: 'string',
          description: 'External label for ticket state',
        },
        created_at: { type: 'number', description: 'Unix timestamp when ticket was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when ticket was last updated' },
        contacts: { type: 'object', description: 'Contacts associated with the ticket' },
        admin_assignee_id: { type: 'string', description: 'ID of assigned admin' },
        team_assignee_id: { type: 'string', description: 'ID of assigned team' },
        is_shared: { type: 'boolean', description: 'Whether the ticket is shared' },
        open: { type: 'boolean', description: 'Whether the ticket is open' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (create_ticket)' },
        ticketId: { type: 'string', description: 'ID of the created ticket' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

export const intercomCreateTicketV2Tool: ToolConfig<
  IntercomCreateTicketParams,
  IntercomCreateTicketV2Response
> = {
  ...createTicketBase,
  id: 'intercom_create_ticket_v2',
  name: 'Create Ticket in Intercom',
  description: 'Create a new ticket in Intercom. Returns API-aligned fields only.',
  version: '2.0.0',

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
        ticketId: data.id,
        success: true,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'Created ticket object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the ticket' },
        type: { type: 'string', description: 'Object type (ticket)' },
        ticket_id: { type: 'string', description: 'Ticket ID' },
        ticket_type: { type: 'object', description: 'Type of the ticket', optional: true },
        ticket_attributes: { type: 'object', description: 'Attributes of the ticket' },
        ticket_state: { type: 'string', description: 'State of the ticket' },
        ticket_state_internal_label: {
          type: 'string',
          description: 'Internal label for ticket state',
        },
        ticket_state_external_label: {
          type: 'string',
          description: 'External label for ticket state',
        },
        created_at: { type: 'number', description: 'Unix timestamp when ticket was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when ticket was last updated' },
        contacts: { type: 'object', description: 'Contacts associated with the ticket' },
        admin_assignee_id: { type: 'string', description: 'ID of assigned admin' },
        team_assignee_id: { type: 'string', description: 'ID of assigned team' },
        is_shared: { type: 'boolean', description: 'Whether the ticket is shared' },
        open: { type: 'boolean', description: 'Whether the ticket is open' },
      },
    },
    ticketId: { type: 'string', description: 'ID of the created ticket' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
