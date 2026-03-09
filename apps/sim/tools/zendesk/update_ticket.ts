import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  TICKET_OUTPUT_PROPERTIES,
} from '@/tools/zendesk/types'

const logger = createLogger('ZendeskUpdateTicket')

export interface ZendeskUpdateTicketParams {
  email: string
  apiToken: string
  subdomain: string
  ticketId: string
  subject?: string
  comment?: string
  priority?: string
  status?: string
  type?: string
  tags?: string
  assigneeId?: string
  groupId?: string
  customFields?: string
}

export interface ZendeskUpdateTicketResponse {
  success: boolean
  output: {
    ticket: any
    ticket_id: number
    success: boolean
  }
}

export const zendeskUpdateTicketTool: ToolConfig<
  ZendeskUpdateTicketParams,
  ZendeskUpdateTicketResponse
> = {
  id: 'zendesk_update_ticket',
  name: 'Update Ticket in Zendesk',
  description: 'Update an existing ticket in Zendesk with support for custom fields',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID to update as a numeric string (e.g., "12345")',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New ticket subject text',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment text to add to the ticket',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority: "low", "normal", "high", or "urgent"',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status: "new", "open", "pending", "hold", "solved", or "closed"',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type: "problem", "incident", "question", or "task"',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags (e.g., "billing, urgent")',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignee user ID as a numeric string (e.g., "12345")',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group ID as a numeric string (e.g., "67890")',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom fields as JSON object (e.g., {"field_id": "value"})',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/tickets/${params.ticketId}`),
    method: 'PUT',
    headers: (params) => {
      // Use Basic Authentication with email/token format for Zendesk API tokens
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const ticket: any = {}

      if (params.subject) ticket.subject = params.subject
      if (params.priority) ticket.priority = params.priority
      if (params.status) ticket.status = params.status
      if (params.type) ticket.type = params.type
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.tags) ticket.tags = params.tags.split(',').map((t) => t.trim())
      if (params.comment) ticket.comment = { body: params.comment }

      if (params.customFields) {
        try {
          const customFields = JSON.parse(params.customFields)
          ticket.custom_fields = Object.entries(customFields).map(([id, value]) => ({ id, value }))
        } catch (error) {
          logger.warn('Failed to parse custom fields', { error })
        }
      }

      return { ticket }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'update_ticket')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ticket: data.ticket,
        ticket_id: data.ticket?.id,
        success: true,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'Updated ticket object',
      properties: TICKET_OUTPUT_PROPERTIES,
    },
    ticket_id: { type: 'number', description: 'The updated ticket ID' },
  },
}
