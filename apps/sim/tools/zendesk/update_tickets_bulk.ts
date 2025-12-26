import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskUpdateTicketsBulk')

export interface ZendeskUpdateTicketsBulkParams {
  email: string
  apiToken: string
  subdomain: string
  ticketIds: string
  status?: string
  priority?: string
  assigneeId?: string
  groupId?: string
  tags?: string
}

export interface ZendeskUpdateTicketsBulkResponse {
  success: boolean
  output: {
    jobStatus: any
    metadata: {
      operation: 'update_tickets_bulk'
      jobId?: string
    }
    success: boolean
  }
}

export const zendeskUpdateTicketsBulkTool: ToolConfig<
  ZendeskUpdateTicketsBulkParams,
  ZendeskUpdateTicketsBulkResponse
> = {
  id: 'zendesk_update_tickets_bulk',
  name: 'Bulk Update Tickets in Zendesk',
  description: 'Update multiple tickets in Zendesk at once (max 100)',
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
    ticketIds: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Comma-separated ticket IDs to update (max 100)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New status for all tickets',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New priority for all tickets',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New assignee ID for all tickets',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New group ID for all tickets',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tags to add to all tickets',
    },
  },

  request: {
    url: (params) => {
      const ids = params.ticketIds.split(',').map((id) => id.trim())
      return buildZendeskUrl(params.subdomain, `/tickets/update_many?ids=${ids.join(',')}`)
    },
    method: 'PUT',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const ticket: any = {}
      if (params.status) ticket.status = params.status
      if (params.priority) ticket.priority = params.priority
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.tags) ticket.tags = params.tags.split(',').map((t) => t.trim())
      return { ticket }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'update_tickets_bulk')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        jobStatus: data.job_status,
        metadata: {
          operation: 'update_tickets_bulk' as const,
          jobId: data.job_status?.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    jobStatus: { type: 'object', description: 'Job status object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
