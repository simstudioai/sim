import type { ToolConfig } from '@/tools/types'
import {
  appendCursorPaginationParams,
  buildZendeskUrl,
  extractCursorPagingInfo,
  handleZendeskError,
  METADATA_OUTPUT,
  PAGING_OUTPUT,
  TICKETS_ARRAY_OUTPUT,
} from '@/tools/zendesk/types'

export interface ZendeskGetTicketsParams {
  email: string
  apiToken: string
  subdomain: string
  status?: string
  priority?: string
  type?: string
  assigneeId?: string
  organizationId?: string
  sort?: string
  perPage?: string
  pageAfter?: string
}

export interface ZendeskGetTicketsResponse {
  success: boolean
  output: {
    tickets: any[]
    paging?: {
      after_cursor: string | null
      has_more: boolean
    }
    metadata: {
      total_returned: number
      has_more: boolean
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
        visibility: 'user-or-llm',
        description: 'Filter by status: "new", "open", "pending", "hold", "solved", or "closed"',
      },
      priority: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by priority: "low", "normal", "high", or "urgent"',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by type: "problem", "incident", "question", or "task"',
      },
      assigneeId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by assignee user ID as a numeric string (e.g., "12345")',
      },
      organizationId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by organization ID as a numeric string (e.g., "67890")',
      },
      sort: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Sort field for ticket listing (only applies without filters): "updated_at", "id", or "status". Prefix with "-" for descending (e.g., "-updated_at")',
      },
      perPage: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Results per page as a number string (default: "100", max: "100")',
      },
      pageAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cursor from a previous response to fetch the next page of results',
      },
    },

    request: {
      url: (params) => {
        const hasFilters =
          params.status ||
          params.priority ||
          params.type ||
          params.assigneeId ||
          params.organizationId

        if (hasFilters) {
          // Use Search API for filtering - the /tickets endpoint doesn't support filter params
          // Build search query using Zendesk search syntax
          const searchTerms: string[] = ['type:ticket']
          if (params.status) searchTerms.push(`status:${params.status}`)
          if (params.priority) searchTerms.push(`priority:${params.priority}`)
          if (params.type) searchTerms.push(`ticket_type:${params.type}`)
          if (params.assigneeId) searchTerms.push(`assignee_id:${params.assigneeId}`)
          if (params.organizationId) searchTerms.push(`organization_id:${params.organizationId}`)

          const queryParams = new URLSearchParams()
          queryParams.append('query', searchTerms.join(' '))
          queryParams.append('filter[type]', 'ticket')
          if (params.perPage) queryParams.append('page[size]', params.perPage)
          if (params.pageAfter) queryParams.append('after_cursor', params.pageAfter)

          return `${buildZendeskUrl(params.subdomain, '/search/export')}?${queryParams.toString()}`
        }

        // No filters - use the simple /tickets endpoint with cursor-based pagination
        const queryParams = new URLSearchParams()
        if (params.sort) queryParams.append('sort', params.sort)
        appendCursorPaginationParams(queryParams, params)

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
      // Handle both /tickets response (data.tickets) and /search response (data.results)
      const tickets = data.tickets || data.results || []
      const paging = extractCursorPagingInfo(data)

      return {
        success: true,
        output: {
          tickets,
          paging,
          metadata: {
            total_returned: tickets.length,
            has_more: paging.has_more,
          },
          success: true,
        },
      }
    },

    outputs: {
      tickets: TICKETS_ARRAY_OUTPUT,
      paging: PAGING_OUTPUT,
      metadata: METADATA_OUTPUT,
    },
  }
