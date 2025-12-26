import { createLogger } from '@sim/logger'
import type {
  HubSpotUpdateCompanyParams,
  HubSpotUpdateCompanyResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotUpdateCompany')

export const hubspotUpdateCompanyTool: ToolConfig<
  HubSpotUpdateCompanyParams,
  HubSpotUpdateCompanyResponse
> = {
  id: 'hubspot_update_company',
  name: 'Update Company in HubSpot',
  description: 'Update an existing company in HubSpot by ID or domain',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID or domain of the company to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Property to use as unique identifier (e.g., "domain"). If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description: 'Company properties to update as JSON object',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/companies/${params.companyId}`
      if (params.idProperty) {
        return `${baseUrl}?idProperty=${params.idProperty}`
      }
      return baseUrl
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      let properties = params.properties
      if (typeof properties === 'string') {
        try {
          properties = JSON.parse(properties)
        } catch (e) {
          throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
        }
      }

      return {
        properties,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update company in HubSpot')
    }

    return {
      success: true,
      output: {
        company: data,
        metadata: {
          operation: 'update_company' as const,
          companyId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    company: { type: 'object', description: 'Updated HubSpot company object' },
    metadata: { type: 'object', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
