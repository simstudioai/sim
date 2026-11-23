import { createLogger } from '@sim/logger'
import { ZENDESK_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  JOB_STATUS_OUTPUT,
  ZENDESK_CREDENTIAL_PARAMS,
  zendeskAuthorization,
} from '@/tools/zendesk/types'

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
    job_status: any
    job_id?: string
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

  oauth: ZENDESK_CREDENTIAL_OAUTH,

  params: {
    ...ZENDESK_CREDENTIAL_PARAMS,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
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
      visibility: 'user-or-llm',
      description:
        'JSON array of ticket objects to create (max 100). Each ticket should have subject and comment properties (e.g., [{"subject": "Issue 1", "comment": {"body": "Description"}}])',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/tickets/create_many'),
    method: 'POST',
    headers: (params) => ({
      Authorization: zendeskAuthorization(params),
      'Content-Type': 'application/json',
    }),
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
        job_status: data.job_status,
        job_id: data.job_status?.id,
        success: true,
      },
    }
  },

  outputs: {
    job_status: JOB_STATUS_OUTPUT,
    job_id: { type: 'string', description: 'The bulk operation job ID' },
  },
}
