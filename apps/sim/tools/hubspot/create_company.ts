import { createLogger } from '@sim/logger'
import type {
  HubSpotCreateCompanyParams,
  HubSpotCreateCompanyResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotCreateCompany')

export const hubspotCreateCompanyTool: ToolConfig<
  HubSpotCreateCompanyParams,
  HubSpotCreateCompanyResponse
> = {
  id: 'hubspot_create_company',
  name: 'Create Company in HubSpot',
  description: 'Create a new company in HubSpot',
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
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-only',
      description: 'Company properties as JSON object (e.g., name, domain, city, industry)',
    },
    associations: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Array of associations to create with the company',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/companies',
    method: 'POST',
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

      const body: any = {
        properties,
      }

      if (params.associations && params.associations.length > 0) {
        body.associations = params.associations
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create company in HubSpot')
    }

    return {
      success: true,
      output: {
        company: data,
        metadata: {
          operation: 'create_company' as const,
          companyId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    company: { type: 'object', description: 'Created HubSpot company object' },
    metadata: { type: 'object', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
