import {
  INCIDENTIO_FOLLOW_UP_SUMMARY_OUTPUT_PROPERTIES,
  type IncidentioFollowUpsShowParams,
  type IncidentioFollowUpsShowResponse,
} from '@/tools/incidentio/types'
import { mapIncidentioFollowUpSummary } from '@/tools/incidentio/utils'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const followUpsShowTool: ToolConfig<
  IncidentioFollowUpsShowParams,
  IncidentioFollowUpsShowResponse
> = {
  id: 'incidentio_follow_ups_show',
  name: 'incident.io Follow-ups Show',
  description: 'Get detailed information about a specific follow-up from incident.io.',
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
      description: 'Follow-up ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v3/follow_ups/${safeUrlPathSegment(params.id, 'id')}`,
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
        follow_up: mapIncidentioFollowUpSummary(data.follow_up),
      },
    }
  },

  outputs: {
    follow_up: {
      type: 'object',
      description: 'Follow-up details',
      properties: INCIDENTIO_FOLLOW_UP_SUMMARY_OUTPUT_PROPERTIES,
    },
  },
}
