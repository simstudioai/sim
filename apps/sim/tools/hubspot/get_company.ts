import { createLogger } from '@sim/logger'
import type { HubSpotGetCompanyParams, HubSpotGetCompanyResponse } from '@/tools/hubspot/types'
import { COMPANY_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetCompany')

export const hubspotGetCompanyTool: ToolConfig<HubSpotGetCompanyParams, HubSpotGetCompanyResponse> =
  {
    id: 'hubspot_get_company',
    name: 'Get Company from HubSpot',
    description: 'Retrieve a single company by ID or domain from HubSpot',
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
        visibility: 'user-or-llm',
        description: 'The HubSpot company ID (numeric string) or domain to retrieve',
      },
      idProperty: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Property to use as unique identifier (e.g., "domain"). If not specified, uses record ID',
      },
      properties: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of HubSpot property names to return (e.g., "name,domain,industry")',
      },
      associations: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of object types to retrieve associated IDs for (e.g., "contacts,deals")',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = `https://api.hubapi.com/crm/v3/objects/companies/${params.companyId}`
        const queryParams = new URLSearchParams()

        if (params.idProperty) {
          queryParams.append('idProperty', params.idProperty)
        }
        if (params.properties) {
          queryParams.append('properties', params.properties)
        }
        if (params.associations) {
          queryParams.append('associations', params.associations)
        }

        const queryString = queryParams.toString()
        return queryString ? `${baseUrl}?${queryString}` : baseUrl
      },
      method: 'GET',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }

        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        logger.error('HubSpot API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to get company from HubSpot')
      }

      return {
        success: true,
        output: {
          company: data,
          companyId: data.id,
          success: true,
        },
      }
    },

    outputs: {
      company: COMPANY_OBJECT_OUTPUT,
      companyId: { type: 'string', description: 'The retrieved company ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
