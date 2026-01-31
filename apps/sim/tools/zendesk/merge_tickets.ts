import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError, JOB_STATUS_OUTPUT } from '@/tools/zendesk/types'

export interface ZendeskMergeTicketsParams {
  email: string
  apiToken: string
  subdomain: string
  targetTicketId: string
  sourceTicketIds: string
  targetComment?: string
}

export interface ZendeskMergeTicketsResponse {
  success: boolean
  output: {
    job_status: any
    job_id?: string
    target_ticket_id: string
    success: boolean
  }
}

export const zendeskMergeTicketsTool: ToolConfig<
  ZendeskMergeTicketsParams,
  ZendeskMergeTicketsResponse
> = {
  id: 'zendesk_merge_tickets',
  name: 'Merge Tickets in Zendesk',
  description: 'Merge multiple tickets into a target ticket',
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
    targetTicketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Target ticket ID as a numeric string (tickets will be merged into this one, e.g., "12345")',
    },
    sourceTicketIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated source ticket IDs to merge (e.g., "111, 222, 333")',
    },
    targetComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment text to add to target ticket after merge',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/tickets/${params.targetTicketId}/merge`),
    method: 'POST',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const ids = params.sourceTicketIds.split(',').map((id) => id.trim())
      const body: any = { ids }
      if (params.targetComment) {
        body.target_comment = {
          body: params.targetComment,
          public: true,
        }
      }
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'merge_tickets')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        job_status: data.job_status,
        job_id: data.job_status?.id,
        target_ticket_id: params?.targetTicketId || '',
        success: true,
      },
    }
  },

  outputs: {
    job_status: JOB_STATUS_OUTPUT,
    job_id: { type: 'string', description: 'The merge job ID' },
    target_ticket_id: {
      type: 'string',
      description: 'The target ticket ID that tickets were merged into',
    },
  },
}
