import type {
  IncidentioActionsShowParams,
  IncidentioActionsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const actionsShowTool: ToolConfig<
  IncidentioActionsShowParams,
  IncidentioActionsShowResponse
> = {
  id: 'incidentio_actions_show',
  name: 'incident.io Actions Show',
  description: 'Get detailed information about a specific action from incident.io.',
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
      description: 'Action ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/actions/${params.id}`,
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
        action: {
          id: data.action.id,
          description: data.action.description || '',
          assignee: data.action.assignee
            ? {
                id: data.action.assignee.id,
                name: data.action.assignee.name,
                email: data.action.assignee.email,
              }
            : undefined,
          status: data.action.status,
          due_at: data.action.due_at,
          created_at: data.action.created_at,
          updated_at: data.action.updated_at,
          incident_id: data.action.incident_id,
          creator: data.action.creator
            ? {
                id: data.action.creator.id,
                name: data.action.creator.name,
                email: data.action.creator.email,
              }
            : undefined,
          completed_at: data.action.completed_at,
          external_issue_reference: data.action.external_issue_reference
            ? {
                provider: data.action.external_issue_reference.provider,
                issue_name: data.action.external_issue_reference.issue_name,
                issue_permalink: data.action.external_issue_reference.issue_permalink,
              }
            : undefined,
        },
      },
    }
  },

  outputs: {
    action: {
      type: 'object',
      description: 'Action details',
      properties: {
        id: { type: 'string', description: 'Action ID' },
        description: { type: 'string', description: 'Action description' },
        assignee: {
          type: 'object',
          description: 'Assigned user',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        status: { type: 'string', description: 'Action status' },
        due_at: { type: 'string', description: 'Due date/time' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        incident_id: { type: 'string', description: 'Associated incident ID' },
        creator: {
          type: 'object',
          description: 'User who created the action',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        completed_at: { type: 'string', description: 'Completion timestamp' },
        external_issue_reference: {
          type: 'object',
          description: 'External issue tracking reference',
          optional: true,
          properties: {
            provider: {
              type: 'string',
              description: 'Issue tracking provider (e.g., Jira, Linear)',
            },
            issue_name: { type: 'string', description: 'Issue identifier' },
            issue_permalink: { type: 'string', description: 'URL to the external issue' },
          },
        },
      },
    },
  },
}
