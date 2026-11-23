import {
  INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
  type IncidentioEscalationPathsShowParams,
  type IncidentioEscalationPathsShowResponse,
} from '@/tools/incidentio/types'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const escalationPathsShowTool: ToolConfig<
  IncidentioEscalationPathsShowParams,
  IncidentioEscalationPathsShowResponse
> = {
  id: 'incidentio_escalation_paths_show',
  name: 'Show Escalation Path',
  description: 'Get details of a specific escalation path in incident.io',
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
      description: 'The ID of the escalation path (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/escalation_paths/${safeUrlPathSegment(params.id, 'id')}`,
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
        escalation_path: data.escalation_path || data,
      },
    }
  },

  outputs: {
    escalation_path: {
      type: 'object',
      description: 'The escalation path details',
      properties: INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
    },
  },
}
