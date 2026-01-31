import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from '@/tools/zendesk/types'

export interface ZendeskDeleteOrganizationParams {
  email: string
  apiToken: string
  subdomain: string
  organizationId: string
}

export interface ZendeskDeleteOrganizationResponse {
  success: boolean
  output: {
    deleted: boolean
    organization_id: string
    success: boolean
  }
}

export const zendeskDeleteOrganizationTool: ToolConfig<
  ZendeskDeleteOrganizationParams,
  ZendeskDeleteOrganizationResponse
> = {
  id: 'zendesk_delete_organization',
  name: 'Delete Organization from Zendesk',
  description: 'Delete an organization from Zendesk',
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
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization ID to delete as a numeric string (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/organizations/${params.organizationId}`),
    method: 'DELETE',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'delete_organization')
    }

    // DELETE returns 204 No Content with empty body
    return {
      success: true,
      output: {
        deleted: true,
        organization_id: params?.organizationId || '',
        success: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the organization was successfully deleted' },
    organization_id: { type: 'string', description: 'The deleted organization ID' },
  },
}
