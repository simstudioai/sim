import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomUpdateTicket')

export interface IntercomUpdateTicketParams {
  accessToken: string
  ticketId: string
  ticket_attributes?: string
  open?: boolean
  is_shared?: boolean
  snoozed_until?: number
  admin_id?: string
  assignee_id?: string
}

export interface IntercomUpdateTicketV2Response {
  success: boolean
  output: {
    ticket: any
    ticketId: string
    ticket_state: string
  }
}

const updateTicketBase = {
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
      description: 'The ID of the ticket to update',
    },
    ticket_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with ticket attributes (e.g., {"_default_title_":"New Title","_default_description_":"Updated description"})',
    },
    open: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to false to close the ticket, true to keep it open',
    },
    is_shared: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the ticket is visible to users',
    },
    snoozed_until: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp for when the ticket should reopen',
    },
    admin_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the admin performing the update (needed for workflows and attribution)',
    },
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the admin or team to assign the ticket to. Set to "0" to unassign.',
    },
  },

  request: {
    url: (params: IntercomUpdateTicketParams) => buildIntercomUrl(`/tickets/${params.ticketId}`),
    method: 'PUT',
    headers: (params: IntercomUpdateTicketParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomUpdateTicketParams) => {
      const payload: any = {}

      if (params.ticket_attributes) {
        try {
          payload.ticket_attributes = JSON.parse(params.ticket_attributes)
        } catch (error) {
          logger.error('Failed to parse ticket_attributes', { error })
          throw new Error('ticket_attributes must be a valid JSON object')
        }
      }

      if (params.open !== undefined) {
        payload.open = params.open
      }

      if (params.is_shared !== undefined) {
        payload.is_shared = params.is_shared
      }

      if (params.snoozed_until !== undefined) {
        payload.snoozed_until = params.snoozed_until
      }

      if (params.admin_id) {
        payload.admin_id = params.admin_id
      }

      if (params.assignee_id) {
        payload.assignee_id = params.assignee_id
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomUpdateTicketParams, any>, 'params' | 'request'>

export const intercomUpdateTicketV2Tool: ToolConfig<
  IntercomUpdateTicketParams,
  IntercomUpdateTicketV2Response
> = {
  ...updateTicketBase,
  id: 'intercom_update_ticket_v2',
  name: 'Update Ticket in Intercom',
  description: 'Update a ticket in Intercom (change state, assignment, attributes)',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'update_ticket')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ticket: {
          id: data.id,
          type: data.type ?? 'ticket',
          ticket_id: data.ticket_id ?? null,
          ticket_state: data.ticket_state ?? null,
          ticket_attributes: data.ticket_attributes ?? null,
          open: data.open ?? null,
          is_shared: data.is_shared ?? null,
          snoozed_until: data.snoozed_until ?? null,
          admin_assignee_id: data.admin_assignee_id ?? null,
          team_assignee_id: data.team_assignee_id ?? null,
          created_at: data.created_at ?? null,
          updated_at: data.updated_at ?? null,
        },
        ticketId: data.id,
        ticket_state: data.ticket_state ?? null,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'The updated ticket object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the ticket' },
        type: { type: 'string', description: 'Object type (ticket)' },
        ticket_id: { type: 'string', description: 'Ticket ID shown in Intercom UI' },
        ticket_state: { type: 'string', description: 'State of the ticket' },
        ticket_attributes: { type: 'object', description: 'Attributes of the ticket' },
        open: { type: 'boolean', description: 'Whether the ticket is open' },
        is_shared: { type: 'boolean', description: 'Whether the ticket is visible to users' },
        snoozed_until: {
          type: 'number',
          description: 'Unix timestamp when ticket will reopen',
          optional: true,
        },
        admin_assignee_id: { type: 'string', description: 'ID of assigned admin', optional: true },
        team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
        created_at: { type: 'number', description: 'Unix timestamp when ticket was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when ticket was last updated' },
      },
    },
    ticketId: { type: 'string', description: 'ID of the updated ticket' },
    ticket_state: { type: 'string', description: 'Current state of the ticket' },
  },
}
