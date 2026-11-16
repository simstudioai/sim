import {
  INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
  type IncidentioEscalationPathsCreateParams,
  type IncidentioEscalationPathsCreateResponse,
} from '@/tools/incidentio/types'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const escalationPathsCreateTool: ToolConfig<
  IncidentioEscalationPathsCreateParams,
  IncidentioEscalationPathsCreateResponse
> = {
  id: 'incidentio_escalation_paths_create',
  name: 'Create Escalation Path',
  description: 'Create a new escalation path in incident.io',
  version: '1.0.0',
  oauth: INCIDENTIO_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the escalation path (e.g., "Critical Incident Path")',
    },
    path: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of escalation path nodes. Each node needs a unique "id" and a "type" (level, notify_channel, delay, if_else, repeat, voicemail, escalation_path); a level node nests its targets under "level", e.g. [{"id":"lvl1","type":"level","level":{"targets":[{"id":"<schedule id>","type":"schedule","schedule_mode":"currently_on_call","urgency":"high"}],"time_to_ack_seconds":300}}]. Target type is schedule, user, slack_channel, or msteams_channel; urgency is high or low.',
    },
    working_hours: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional. Array of working-hours windows, each {id, name, timezone, weekday_intervals: [{weekday, start_time, end_time}]}, e.g. [{"id":"wh","name":"Business hours","timezone":"Europe/London","weekday_intervals":[{"weekday":"monday","start_time":"09:00","end_time":"17:00"}]}]',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/escalation_paths',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        path: params.path,
      }

      if (params.working_hours) {
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
      description: 'The created escalation path',
      properties: INCIDENTIO_ESCALATION_PATH_OUTPUT_PROPERTIES,
    },
  },
}
