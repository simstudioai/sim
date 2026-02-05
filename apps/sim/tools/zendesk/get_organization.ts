import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  ORGANIZATION_OUTPUT_PROPERTIES,
} from '@/tools/zendesk/types'

export interface ZendeskGetOrganizationParams {
  email: string
  apiToken: string
  subdomain: string
  organizationId: string
}

export interface ZendeskGetOrganizationResponse {
  success: boolean
  output: {
    organization: any
    organization_id: number
    success: boolean
  }
}

export const zendeskGetOrganizationTool: ToolConfig<
  ZendeskGetOrganizationParams,
  ZendeskGetOrganizationResponse
> = {
  id: 'zendesk_get_organization',
  name: 'Get Single Organization from Zendesk',
  description: 'Get a single organization by ID from Zendesk',
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
      description: 'Organization ID to retrieve as a numeric string (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/organizations/${params.organizationId}`),
    method: 'GET',
    headers: (params) => {
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
      handleZendeskError(data, response.status, 'get_organization')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        organization: data.organization,
        organization_id: data.organization?.id,
        success: true,
      },
    }
  },

  outputs: {
    organization: {
      type: 'object',
      description: 'Organization object',
      properties: ORGANIZATION_OUTPUT_PROPERTIES,
    },
    organization_id: { type: 'number', description: 'The organization ID' },
  },
}
