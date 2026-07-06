import type {
  PagerDutyMergeIncidentsParams,
  PagerDutyMergeIncidentsResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const mergeIncidentsTool: ToolConfig<
  PagerDutyMergeIncidentsParams,
  PagerDutyMergeIncidentsResponse
> = {
  id: 'pagerduty_merge_incidents',
  name: 'PagerDuty Merge Incidents',
  description:
    'Merge one or more source incidents into a target incident. Source incidents are resolved and their alerts move to the target.',
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
    targetIncidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident that will absorb the source incidents',
    },
    sourceIncidentIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated IDs of the incidents to merge into the target incident',
    },
  },

  request: {
    url: (params) => `https://api.pagerduty.com/incidents/${params.targetIncidentId.trim()}/merge`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: params.fromEmail,
    }),
    body: (params) => ({
      source_incidents: params.sourceIncidentIds.split(',').map((id) => ({
        id: id.trim(),
        type: 'incident_reference',
      })),
    }),
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
        title: inc.title ?? null,
        status: inc.status ?? null,
        htmlUrl: inc.html_url ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Target incident ID' },
    incidentNumber: { type: 'number', description: 'Target incident number' },
    title: { type: 'string', description: 'Target incident title' },
    status: { type: 'string', description: 'Target incident status' },
    htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
  },
}
