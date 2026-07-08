import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyAttributionParams,
  type DowndetectorGetCompanyAttributionResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawAttribution {
  attribution?: number
  attribution_calculated_at?: string
  user_impact?: number
  user_impact_calculated_at?: string
  reason?: number
  danger_duration_s?: number
  incident_id?: number
  incident_created_at?: string
}

export const getCompanyAttributionTool: ToolConfig<
  DowndetectorGetCompanyAttributionParams,
  DowndetectorGetCompanyAttributionResponse
> = {
  id: 'downdetector_get_company_attribution',
  name: 'Downdetector Get Company Attribution',
  description:
    'Get the incident attribution for a Downdetector company while it is in an outage state — whether the issue is internal (isolated) or external (a dependency), the estimated user impact, and the related incident. Requires Incident Attribution access.',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) =>
      `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/attribution`,
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data: RawAttribution = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company attribution'))
    }

    return {
      success: true,
      output: {
        attribution: {
          attribution: data.attribution ?? null,
          attributionCalculatedAt: data.attribution_calculated_at ?? null,
          userImpact: data.user_impact ?? null,
          userImpactCalculatedAt: data.user_impact_calculated_at ?? null,
          reason: data.reason ?? null,
          dangerDurationS: data.danger_duration_s ?? null,
          incidentId: data.incident_id ?? null,
          incidentCreatedAt: data.incident_created_at ?? null,
        },
      },
    }
  },

  outputs: {
    attribution: {
      type: 'object',
      description: 'Incident attribution detail',
      properties: {
        attribution: {
          type: 'number',
          description: 'Attribution enum (0 N/A, 1 undetermined, 2 external, 3 internal)',
        },
        attributionCalculatedAt: {
          type: 'string',
          description: 'ISO 8601 timestamp when attribution was calculated',
        },
        userImpact: {
          type: 'number',
          description: 'User impact enum (0 low, 1 medium, 2 high, 3 very high)',
        },
        userImpactCalculatedAt: {
          type: 'string',
          description: 'ISO 8601 timestamp when user impact was calculated',
        },
        reason: {
          type: 'number',
          description: 'Reason enum explaining how the attribution value was calculated (0-7)',
        },
        dangerDurationS: {
          type: 'number',
          description: 'Duration of the current danger (outage) state in seconds',
        },
        incidentId: {
          type: 'number',
          description: 'Id of the related incident (null when attribution is N/A)',
        },
        incidentCreatedAt: {
          type: 'string',
          description: 'ISO 8601 timestamp when the related incident was created',
        },
      },
    },
  },
}
