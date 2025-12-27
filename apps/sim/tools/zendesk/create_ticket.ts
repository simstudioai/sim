import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskCreateTicket')

export interface ZendeskCreateTicketParams {
  email: string
  apiToken: string
  subdomain: string
  subject: string
  description: string
  priority?: string
  status?: string
  type?: string
  tags?: string
  assigneeId?: string
  groupId?: string
  requesterId?: string
  customFields?: string
}

export interface ZendeskCreateTicketResponse {
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

export const zendeskCreateTicketTool: ToolConfig<
  ZendeskCreateTicketParams,
  ZendeskCreateTicketResponse
> = {
  id: 'zendesk_create_ticket',
  name: 'Create Ticket in Zendesk',
  description: 'Create a new ticket in Zendesk with support for custom fields',
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
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Ticket subject (optional - will be auto-generated if not provided)',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ticket description (first comment)',
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
    requesterId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Requester user ID',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object (e.g., {"field_id": "value"})',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/tickets'),
    method: 'POST',
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
      const ticket: any = {
        subject: params.subject,
        comment: { body: params.description },
      }

      if (params.priority) ticket.priority = params.priority
      if (params.status) ticket.status = params.status
      if (params.type) ticket.type = params.type
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.requesterId) ticket.requester_id = params.requesterId
      if (params.tags) ticket.tags = params.tags.split(',').map((t) => t.trim())

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
      handleZendeskError(data, response.status, 'create_ticket')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ticket: data.ticket,
        metadata: {
          operation: 'create_ticket' as const,
          ticketId: data.ticket?.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    ticket: { type: 'object', description: 'Created ticket object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
