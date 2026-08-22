import {
  INCIDENTIO_FOLLOW_UP_RECORD_OUTPUT_PROPERTIES,
  type IncidentioFollowUpsCreateParams,
  type IncidentioFollowUpsCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const followUpsCreateTool: ToolConfig<
  IncidentioFollowUpsCreateParams,
  IncidentioFollowUpsCreateResponse
> = {
  id: 'incidentio_follow_ups_create',
  name: 'Create Follow-up',
  description: 'Create a new follow-up on an incident in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    incident_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the incident the follow-up belongs to (e.g., "01FDAG4SAP5TYPT98WGR2N7W91")',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the follow-up (e.g., "Add alerting on connection pool saturation")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the follow-up. Supports Markdown.',
    },
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user to assign this follow-up to',
    },
    assignee_team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the team to assign this follow-up to',
    },
    follow_up_category_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the category for this follow-up',
    },
    follow_up_priority_option_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the priority for this follow-up',
    },
    external_issue_reference_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the external issue this follow-up relates to',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of labels (e.g., "bug,urgent")',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/follow_ups',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        incident_id: params.incident_id.trim(),
        title: params.title,
      }

      if (params.description) body.description = params.description
      if (params.assignee_id) body.assignee_id = params.assignee_id.trim()
      if (params.assignee_team_id) body.assignee_team_id = params.assignee_team_id.trim()
      if (params.follow_up_category_id) {
        body.follow_up_category_id = params.follow_up_category_id.trim()
      }
      if (params.follow_up_priority_option_id) {
        body.follow_up_priority_option_id = params.follow_up_priority_option_id.trim()
      }
      if (params.external_issue_reference_id) {
        body.external_issue_reference_id = params.external_issue_reference_id.trim()
      }
      if (params.labels) {
        body.labels = params.labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        follow_up: data.follow_up,
      },
    }
  },

  outputs: {
    follow_up: {
      type: 'object',
      description: 'The created follow-up',
      properties: INCIDENTIO_FOLLOW_UP_RECORD_OUTPUT_PROPERTIES,
    },
  },
}
