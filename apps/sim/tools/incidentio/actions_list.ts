import type {
  IncidentioActionsListParams,
  IncidentioActionsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const actionsListTool: ToolConfig<
  IncidentioActionsListParams,
  IncidentioActionsListResponse
> = {
  id: 'incidentio_actions_list',
  name: 'incident.io Actions List',
  description: 'List actions from incident.io. Optionally filter by incident ID.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter actions by incident ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of actions to return per page (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/actions')

      if (params.incident_id) {
        url.searchParams.append('incident_id', params.incident_id)
      }

      if (params.page_size) {
        url.searchParams.append('page_size', params.page_size.toString())
      }

      return url.toString()
    },
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
        actions:
          data.actions?.map((action: any) => ({
            id: action.id,
            description: action.description || '',
            assignee: action.assignee
              ? {
                  id: action.assignee.id,
                  name: action.assignee.name,
                  email: action.assignee.email,
                }
              : undefined,
            status: action.status,
            due_at: action.due_at,
            created_at: action.created_at,
            updated_at: action.updated_at,
            incident_id: action.incident_id,
            creator: action.creator
              ? {
                  id: action.creator.id,
                  name: action.creator.name,
                  email: action.creator.email,
                }
              : undefined,
            completed_at: action.completed_at,
            external_issue_reference: action.external_issue_reference
              ? {
                  provider: action.external_issue_reference.provider,
                  issue_name: action.external_issue_reference.issue_name,
                  issue_permalink: action.external_issue_reference.issue_permalink,
                }
              : undefined,
          })) || [],
      },
    }
  },

  outputs: {
    actions: {
      type: 'array',
      description: 'List of actions',
      items: {
        type: 'object',
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
  },
}
