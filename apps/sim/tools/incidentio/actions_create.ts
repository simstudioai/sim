import {
  INCIDENTIO_ACTION_RECORD_OUTPUT_PROPERTIES,
  type IncidentioActionsCreateParams,
  type IncidentioActionsCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const actionsCreateTool: ToolConfig<
  IncidentioActionsCreateParams,
  IncidentioActionsCreateResponse
> = {
  id: 'incidentio_actions_create',
  name: 'Create Action',
  description: 'Create a new action on an incident in incident.io',
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
        'The ID of the incident the action belongs to (e.g., "01FDAG4SAP5TYPT98WGR2N7W91")',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the action. Supports Markdown.',
    },
    assignee_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user to assign this action to',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/actions',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        incident_id: params.incident_id.trim(),
        description: params.description,
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
      description: 'The created action',
      properties: INCIDENTIO_ACTION_RECORD_OUTPUT_PROPERTIES,
    },
  },
}
