import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

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
    metadata: {
      operation: 'update_ticket'
      ticketId: string
    }
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
      visibility: 'user-only',
      description: 'Ticket ID to update',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New ticket subject',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Add a comment to the ticket',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Priority (low, normal, high, urgent)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status (new, open, pending, hold, solved, closed)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Type (problem, incident, question, task)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tags',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Assignee user ID',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Group ID',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object',
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
        metadata: {
          operation: 'update_ticket' as const,
          ticketId: data.ticket?.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    ticket: { type: 'object', description: 'Updated ticket object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
