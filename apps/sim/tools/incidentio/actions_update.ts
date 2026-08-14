import {
  INCIDENTIO_ACTION_RECORD_OUTPUT_PROPERTIES,
  type IncidentioActionsUpdateParams,
  type IncidentioActionsUpdateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const actionsUpdateTool: ToolConfig<
  IncidentioActionsUpdateParams,
  IncidentioActionsUpdateResponse
> = {
  id: 'incidentio_actions_update',
  name: 'Update Action',
  description:
    'Update an existing action in incident.io, for example to mark it completed or reassign it',
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
      description: 'The ID of the action to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Description of the action. This endpoint replaces the description, so always send it.',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Status of the action: "outstanding", "completed", or "not_doing". Deleting is not supported here.',
    },
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user to assign this action to',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/actions/${encodeURIComponent(params.id.trim())}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        description: params.description,
        status: params.status,
      }

      if (params.assignee_id) body.assignee_id = params.assignee_id.trim()

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        action: data.action,
      },
    }
  },

  outputs: {
    action: {
      type: 'object',
      description: 'The updated action',
      properties: INCIDENTIO_ACTION_RECORD_OUTPUT_PROPERTIES,
    },
  },
}
