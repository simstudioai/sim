import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError, JOB_STATUS_OUTPUT } from '@/tools/zendesk/types'

const logger = createLogger('ZendeskCreateUsersBulk')

export interface ZendeskCreateUsersBulkParams {
  email: string
  apiToken: string
  subdomain: string
  users: string
}

export interface ZendeskCreateUsersBulkResponse {
  success: boolean
  output: {
    job_status: any
    job_id: string
    success: boolean
  }
}

export const zendeskCreateUsersBulkTool: ToolConfig<
  ZendeskCreateUsersBulkParams,
  ZendeskCreateUsersBulkResponse
> = {
  id: 'zendesk_create_users_bulk',
  name: 'Bulk Create Users in Zendesk',
  description: 'Create multiple users in Zendesk using bulk import',
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
    users: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of user objects to create (e.g., [{"name": "User1", "email": "user1@example.com"}])',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/users/create_many'),
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
        const users = JSON.parse(params.users)
        return { users }
      } catch (error) {
        logger.error('Failed to parse users array', { error })
        throw new Error('Invalid users JSON format')
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'create_users_bulk')
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
