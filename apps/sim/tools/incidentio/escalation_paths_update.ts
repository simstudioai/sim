import {
  INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
  type IncidentioEscalationPathsUpdateParams,
  type IncidentioEscalationPathsUpdateResponse,
} from '@/tools/incidentio/types'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const escalationPathsUpdateTool: ToolConfig<
  IncidentioEscalationPathsUpdateParams,
  IncidentioEscalationPathsUpdateResponse
> = {
  id: 'incidentio_escalation_paths_update',
  name: 'Update Escalation Path',
  description: 'Update an existing escalation path in incident.io',
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
      description: 'The ID of the escalation path to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the escalation path (e.g., "Critical Incident Path")',
    },
    path: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New escalation path configuration. Array of escalation path nodes. Each node needs a unique "id" and a "type" (level, notify_channel, delay, if_else, repeat, voicemail, escalation_path); a level node nests its targets under "level", e.g. [{"id":"lvl1","type":"level","level":{"targets":[{"id":"<schedule id>","type":"schedule","schedule_mode":"currently_on_call","urgency":"high"}],"time_to_ack_seconds":300}}]. Target type is schedule, user, slack_channel, or msteams_channel; urgency is high or low.',
    },
    working_hours: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New working hours configuration. Array of working-hours windows, each {id, name, timezone, weekday_intervals: [{weekday, start_time, end_time}]}, e.g. [{"id":"wh","name":"Business hours","timezone":"Europe/London","weekday_intervals":[{"weekday":"monday","start_time":"09:00","end_time":"17:00"}]}]',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/escalation_paths/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        path: params.path,
      }

      if (params.working_hours !== undefined) {
        body.working_hours = params.working_hours
      }

      return body
    },
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
      description: 'The updated escalation path',
      properties: INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
    },
  },
}
