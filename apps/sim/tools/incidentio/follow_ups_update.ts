import {
  INCIDENTIO_FOLLOW_UP_RECORD_OUTPUT_PROPERTIES,
  type IncidentioFollowUpsUpdateParams,
  type IncidentioFollowUpsUpdateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const followUpsUpdateTool: ToolConfig<
  IncidentioFollowUpsUpdateParams,
  IncidentioFollowUpsUpdateResponse
> = {
  id: 'incidentio_follow_ups_update',
  name: 'Update Follow-up',
  description:
    'Update an existing follow-up in incident.io, for example to mark it completed or reassign it',
  version: '1.0.0',

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
      description: 'The ID of the follow-up to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the follow-up. This endpoint replaces the title, so always send it.',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Status of the follow-up: "outstanding", "completed", or "not_doing". Deleting is not supported here.',
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
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of labels (e.g., "bug,urgent")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/follow_ups/${safeUrlPathSegment(params.id, 'id')}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
        status: params.status,
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
      description: 'The updated follow-up',
      properties: INCIDENTIO_FOLLOW_UP_RECORD_OUTPUT_PROPERTIES,
    },
  },
}
