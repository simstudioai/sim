import type {
  PagerDutySnoozeIncidentParams,
  PagerDutySnoozeIncidentResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const snoozeIncidentTool: ToolConfig<
  PagerDutySnoozeIncidentParams,
  PagerDutySnoozeIncidentResponse
> = {
  id: 'pagerduty_snooze_incident',
  name: 'PagerDuty Snooze Incident',
  description:
    'Snooze a triggered PagerDuty incident for a number of seconds, after which it returns to triggered.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    fromEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of a valid PagerDuty user',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident to snooze',
    },
    duration: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of seconds to snooze the incident for (1 to 604800)',
    },
  },

  request: {
    url: (params) => `https://api.pagerduty.com/incidents/${params.incidentId.trim()}/snooze`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: params.fromEmail,
    }),
    body: (params) => {
      const duration = Number(params.duration)
      if (!Number.isFinite(duration) || duration < 1 || duration > 604800) {
        throw new Error('duration must be a whole number of seconds between 1 and 604800')
      }
      return { duration }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    const inc = data.incident ?? {}
    return {
      success: true,
      output: {
        id: inc.id ?? null,
        incidentNumber: inc.incident_number ?? null,
        status: inc.status ?? null,
        htmlUrl: inc.html_url ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Incident ID' },
    incidentNumber: { type: 'number', description: 'Incident number' },
    status: { type: 'string', description: 'Incident status after snoozing' },
    htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
  },
}
