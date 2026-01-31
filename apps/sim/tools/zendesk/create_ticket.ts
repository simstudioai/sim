import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  TICKET_OUTPUT_PROPERTIES,
} from '@/tools/zendesk/types'

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
    ticket_id: number
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
      visibility: 'user-or-llm',
      description: 'Ticket subject (optional - will be auto-generated if not provided)',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket description text (first comment)',
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
    requesterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requester user ID as a numeric string (e.g., "11111")',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
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
        ticket_id: data.ticket?.id,
        success: true,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'Created ticket object',
      properties: TICKET_OUTPUT_PROPERTIES,
    },
    ticket_id: { type: 'number', description: 'The created ticket ID' },
  },
}
