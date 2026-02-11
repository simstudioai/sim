import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

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

export interface IntercomGetTicketV2Response {
  success: boolean
  output: {
    ticket: any
    ticketId: string
    success: boolean
  }
}

const getTicketBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID to retrieve',
    },
  },
  request: {
    url: (params: IntercomGetTicketParams) => buildIntercomUrl(`/tickets/${params.ticketId}`),
    method: 'GET',
    headers: (params: IntercomGetTicketParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomGetTicketParams, any>, 'params' | 'request'>

export const intercomGetTicketTool: ToolConfig<IntercomGetTicketParams, IntercomGetTicketResponse> =
  {
    id: 'intercom_get_ticket',
    name: 'Get Ticket from Intercom',
    description: 'Retrieve a single ticket by ID from Intercom',
    version: '1.0.0',

    ...getTicketBase,

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
      ticket: {
        type: 'object',
        description: 'Ticket object',
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
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when ticket was last updated',
          },
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
          operation: { type: 'string', description: 'The operation performed (get_ticket)' },
        },
      },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }

export const intercomGetTicketV2Tool: ToolConfig<
  IntercomGetTicketParams,
  IntercomGetTicketV2Response
> = {
  ...getTicketBase,
  id: 'intercom_get_ticket_v2',
  name: 'Get Ticket from Intercom',
  description: 'Retrieve a single ticket by ID from Intercom. Returns API-aligned fields only.',
  version: '2.0.0',

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
        ticketId: data.id,
        success: true,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'Ticket object',
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
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when ticket was last updated',
        },
        contacts: { type: 'object', description: 'Contacts associated with the ticket' },
        admin_assignee_id: { type: 'string', description: 'ID of assigned admin' },
        team_assignee_id: { type: 'string', description: 'ID of assigned team' },
        is_shared: { type: 'boolean', description: 'Whether the ticket is shared' },
        open: { type: 'boolean', description: 'Whether the ticket is open' },
      },
    },
    ticketId: { type: 'string', description: 'ID of the retrieved ticket' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
