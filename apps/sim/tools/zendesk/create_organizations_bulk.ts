import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError, JOB_STATUS_OUTPUT } from '@/tools/zendesk/types'

const logger = createLogger('ZendeskCreateOrganizationsBulk')

export interface ZendeskCreateOrganizationsBulkParams {
  email: string
  apiToken: string
  subdomain: string
  organizations: string
}

export interface ZendeskCreateOrganizationsBulkResponse {
  success: boolean
  output: {
    job_status: any
    job_id: string
    success: boolean
  }
}

export const zendeskCreateOrganizationsBulkTool: ToolConfig<
  ZendeskCreateOrganizationsBulkParams,
  ZendeskCreateOrganizationsBulkResponse
> = {
  id: 'zendesk_create_organizations_bulk',
  name: 'Bulk Create Organizations in Zendesk',
  description: 'Create multiple organizations in Zendesk using bulk import',
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
    organizations: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of organization objects to create (e.g., [{"name": "Org1"}, {"name": "Org2"}])',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/organizations/create_many'),
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
        const organizations = JSON.parse(params.organizations)
        return { organizations }
      } catch (error) {
        logger.error('Failed to parse organizations array', { error })
        throw new Error('Invalid organizations JSON format')
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'create_organizations_bulk')
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
