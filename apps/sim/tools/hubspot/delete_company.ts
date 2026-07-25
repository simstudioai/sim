import { createLogger } from '@sim/logger'
import type {
  HubSpotDeleteCompanyParams,
  HubSpotDeleteCompanyResponse,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteCompany')

export const hubspotDeleteCompanyTool: ToolConfig<
  HubSpotDeleteCompanyParams,
  HubSpotDeleteCompanyResponse
> = {
  id: 'hubspot_delete_company',
  name: 'Delete Company from HubSpot',
  description: 'Archive a company in HubSpot by ID (moves it to the recycling bin)',
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
      description: 'The numeric ID of the company to delete',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/objects/companies/${params.companyId.trim()}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete company from HubSpot')
    }
    return {
      success: true,
      output: {
        companyId: params?.companyId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'ID of the deleted company' },
    deleted: { type: 'boolean', description: 'Whether the company was archived' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
