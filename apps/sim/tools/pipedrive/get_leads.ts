import { createLogger } from '@/lib/logs/console/logger'
import type { PipedriveGetLeadsParams, PipedriveGetLeadsResponse } from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetLeads')

export const pipedriveGetLeadsTool: ToolConfig<PipedriveGetLeadsParams, PipedriveGetLeadsResponse> =
  {
    id: 'pipedrive_get_leads',
    name: 'Get Leads from Pipedrive',
    description: 'Retrieve all leads or a specific lead from Pipedrive',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'pipedrive',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'The access token for the Pipedrive API',
      },
      lead_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Optional: ID of a specific lead to retrieve',
      },
      archived: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Get archived leads instead of active ones',
      },
      owner_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by owner user ID',
      },
      person_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by person ID',
      },
      organization_id: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Filter by organization ID',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Number of results to return (default: 100, max: 500)',
      },
    },

    request: {
      url: (params) => {
        // If lead_id is provided, get specific lead
        if (params.lead_id) {
          return `https://api.pipedrive.com/v1/leads/${params.lead_id}`
        }

        // Get archived or active leads with optional filters
        const baseUrl =
          params.archived === 'true'
            ? 'https://api.pipedrive.com/v1/leads/archived'
            : 'https://api.pipedrive.com/v1/leads'

        const queryParams = new URLSearchParams()

        if (params.owner_id) queryParams.append('owner_id', params.owner_id)
        if (params.person_id) queryParams.append('person_id', params.person_id)
        if (params.organization_id) queryParams.append('organization_id', params.organization_id)
        if (params.limit) queryParams.append('limit', params.limit)

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
          Accept: 'application/json',
        }
      },
    },

    transformResponse: async (response: Response, params) => {
      const data = await response.json()

      if (!data.success) {
        logger.error('Pipedrive API request failed', { data })
        throw new Error(data.error || 'Failed to fetch lead(s) from Pipedrive')
      }

      // If lead_id was provided, return single lead
      if (params?.lead_id) {
        return {
          success: true,
          output: {
            lead: data.data,
            metadata: {
              operation: 'get_leads' as const,
            },
            success: true,
          },
        }
      }

      // Otherwise, return list of leads
      const leads = data.data || []

      return {
        success: true,
        output: {
          leads,
          metadata: {
            operation: 'get_leads' as const,
            totalItems: leads.length,
          },
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      output: {
        type: 'object',
        description: 'Leads data or single lead details',
        properties: {
          leads: {
            type: 'array',
            description: 'Array of lead objects (when listing all)',
          },
          lead: {
            type: 'object',
            description: 'Single lead object (when lead_id is provided)',
          },
          metadata: {
            type: 'object',
            description: 'Operation metadata',
          },
          success: { type: 'boolean', description: 'Operation success status' },
        },
      },
    },
  }
