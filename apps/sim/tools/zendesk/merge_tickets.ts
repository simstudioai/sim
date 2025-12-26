import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskMergeTickets')

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
    jobStatus: any
    metadata: {
      operation: 'merge_tickets'
      jobId?: string
      targetTicketId: string
    }
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
      visibility: 'user-only',
      description: 'Target ticket ID (tickets will be merged into this one)',
    },
    sourceTicketIds: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Comma-separated source ticket IDs to merge',
    },
    targetComment: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comment to add to target ticket after merge',
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
        jobStatus: data.job_status,
        metadata: {
          operation: 'merge_tickets' as const,
          jobId: data.job_status?.id,
          targetTicketId: params?.targetTicketId || '',
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
