import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskCreateOrganization')

export interface ZendeskCreateOrganizationParams {
  email: string
  apiToken: string
  subdomain: string
  name: string
  domainNames?: string
  details?: string
  notes?: string
  tags?: string
  customFields?: string
}

export interface ZendeskCreateOrganizationResponse {
  success: boolean
  output: {
    organization: any
    metadata: {
      operation: 'create_organization'
      organizationId: string
    }
    success: boolean
  }
}

export const zendeskCreateOrganizationTool: ToolConfig<
  ZendeskCreateOrganizationParams,
  ZendeskCreateOrganizationResponse
> = {
  id: 'zendesk_create_organization',
  name: 'Create Organization in Zendesk',
  description: 'Create a new organization in Zendesk',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Organization name',
    },
    domainNames: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated domain names',
    },
    details: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Organization details',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Organization notes',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tags',
    },
    customFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom fields as JSON object (e.g., {"field_id": "value"})',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, '/organizations'),
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
      const organization: any = {
        name: params.name,
      }

      if (params.domainNames)
        organization.domain_names = params.domainNames.split(',').map((d) => d.trim())
      if (params.details) organization.details = params.details
      if (params.notes) organization.notes = params.notes
      if (params.tags) organization.tags = params.tags.split(',').map((t) => t.trim())

      if (params.customFields) {
        try {
          const customFields = JSON.parse(params.customFields)
          organization.organization_fields = customFields
        } catch (error) {
          logger.warn('Failed to parse custom fields', { error })
        }
      }

      return { organization }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'create_organization')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        organization: data.organization,
        metadata: {
          operation: 'create_organization' as const,
          organizationId: data.organization?.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    organization: { type: 'object', description: 'Created organization object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
