import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskCreateTicketsBulk')

export interface ZendeskCreateTicketsBulkParams {
  email: string
  apiToken: string
  subdomain: string
  tickets: string
}

export interface ZendeskCreateTicketsBulkResponse {
  success: boolean
  output: {
    jobStatus: any
    metadata: {
      operation: 'create_tickets_bulk'
      jobId?: string
    }
    success: boolean
  }
}

export const zendeskCreateTicketsBulkTool: ToolConfig<
  ZendeskCreateTicketsBulkParams,
  ZendeskCreateTicketsBulkResponse
> = {
  id: 'zendesk_create_tickets_bulk',
  name: 'Bulk Create Tickets in Zendesk',
  description: 'Create multiple tickets in Zendesk at once (max 100)',
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
    tickets: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'JSON array of ticket objects to create (max 100). Each ticket should have subject and comment properties.',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/tickets/create_many'),
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
      try {
        const tickets = JSON.parse(params.tickets)
        return { tickets }
      } catch (error) {
        logger.error('Failed to parse tickets JSON', { error })
        throw new Error('Invalid tickets JSON format')
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'create_tickets_bulk')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        jobStatus: data.job_status,
        metadata: {
          operation: 'create_tickets_bulk' as const,
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
