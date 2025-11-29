import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskGetTickets')

export interface ZendeskGetTicketsParams {
  email: string
  apiToken: string
  subdomain: string
  status?: string
  priority?: string
  type?: string
  assigneeId?: string
  organizationId?: string
  sortBy?: string
  sortOrder?: string
  perPage?: string
  page?: string
}

export interface ZendeskGetTicketsResponse {
  success: boolean
  output: {
    tickets: any[]
    paging?: {
      nextPage?: string | null
      previousPage?: string | null
      count: number
    }
    metadata: {
      operation: 'get_tickets'
      totalReturned: number
    }
    success: boolean
  }
}

export const zendeskGetTicketsTool: ToolConfig<ZendeskGetTicketsParams, ZendeskGetTicketsResponse> =
  {
    id: 'zendesk_get_tickets',
    name: 'Get Tickets from Zendesk',
    description: 'Retrieve a list of tickets from Zendesk with optional filtering',
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
        description: 'Your Zendesk subdomain (e.g., "mycompany" for mycompany.zendesk.com)',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by status (new, open, pending, hold, solved, closed)',
      },
      priority: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by priority (low, normal, high, urgent)',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by type (problem, incident, question, task)',
      },
      assigneeId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by assignee user ID',
      },
      organizationId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by organization ID',
      },
      sortBy: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Sort field (created_at, updated_at, priority, status)',
      },
      sortOrder: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Sort order (asc or desc)',
      },
      perPage: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Results per page (default: 100, max: 100)',
      },
      page: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Page number',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.status) queryParams.append('status', params.status)
        if (params.priority) queryParams.append('priority', params.priority)
        if (params.type) queryParams.append('type', params.type)
        if (params.assigneeId) queryParams.append('assignee_id', params.assigneeId)
        if (params.organizationId) queryParams.append('organization_id', params.organizationId)
        if (params.sortBy) queryParams.append('sort_by', params.sortBy)
        if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)
        if (params.page) queryParams.append('page', params.page)
        if (params.perPage) queryParams.append('per_page', params.perPage)

        const query = queryParams.toString()
        const url = buildZendeskUrl(params.subdomain, '/tickets')
        return query ? `${url}?${query}` : url
      },
      method: 'GET',
      headers: (params) => {
        // Use Basic Authentication with email/token format for Zendesk API tokens
        const credentials = `${params.email}/token:${params.apiToken}`
        const base64Credentials = Buffer.from(credentials).toString('base64')
        return {
          Authorization: `Basic ${base64Credentials}`,
          'Content-Type': 'application/json',
        }
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const data = await response.json()
        handleZendeskError(data, response.status, 'get_tickets')
      }

      const data = await response.json()
      const tickets = data.tickets || []

      return {
        success: true,
        output: {
          tickets,
          paging: {
            nextPage: data.next_page,
            previousPage: data.previous_page,
            count: data.count || tickets.length,
          },
          metadata: {
            operation: 'get_tickets' as const,
            totalReturned: tickets.length,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Tickets data and metadata',
        properties: {
          tickets: { type: 'array', description: 'Array of ticket objects' },
          paging: { type: 'object', description: 'Pagination information' },
          metadata: { type: 'object', description: 'Operation metadata' },
          success: { type: 'boolean', description: 'Operation success' },
        },
      },
    },
  }
