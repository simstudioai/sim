import {
  INCIDENTIO_ACTION_SUMMARY_OUTPUT_PROPERTIES,
  type IncidentioActionsShowParams,
  type IncidentioActionsShowResponse,
} from '@/tools/incidentio/types'
import { mapIncidentioActionSummary } from '@/tools/incidentio/utils'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const actionsShowTool: ToolConfig<
  IncidentioActionsShowParams,
  IncidentioActionsShowResponse
> = {
  id: 'incidentio_actions_show',
  name: 'incident.io Actions Show',
  description: 'Get detailed information about a specific action from incident.io.',
  version: '1.0.0',
  oauth: INCIDENTIO_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v3/actions/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        action: mapIncidentioActionSummary(data.action),
      },
    }
  },

  outputs: {
    action: {
      type: 'object',
      description: 'Action details',
      properties: INCIDENTIO_ACTION_SUMMARY_OUTPUT_PROPERTIES,
    },
  },
}
