import type {
  IncidentioFollowUpsShowParams,
  IncidentioFollowUpsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const followUpsShowTool: ToolConfig<
  IncidentioFollowUpsShowParams,
  IncidentioFollowUpsShowResponse
> = {
  id: 'incidentio_follow_ups_show',
  name: 'incident.io Follow-ups Show',
  description: 'Get detailed information about a specific follow-up from incident.io.',
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
      description: 'Follow-up ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/follow_ups/${params.id}`,
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
        follow_up: {
          id: data.follow_up.id,
          title: data.follow_up.title || '',
          description: data.follow_up.description,
          assignee: data.follow_up.assignee
            ? {
                id: data.follow_up.assignee.id,
                name: data.follow_up.assignee.name,
                email: data.follow_up.assignee.email,
              }
            : undefined,
          status: data.follow_up.status,
          priority: data.follow_up.priority
            ? {
                id: data.follow_up.priority.id,
                name: data.follow_up.priority.name,
                description: data.follow_up.priority.description,
                rank: data.follow_up.priority.rank,
              }
            : undefined,
          created_at: data.follow_up.created_at,
          updated_at: data.follow_up.updated_at,
          incident_id: data.follow_up.incident_id,
          creator: data.follow_up.creator
            ? {
                id: data.follow_up.creator.id,
                name: data.follow_up.creator.name,
                email: data.follow_up.creator.email,
              }
            : undefined,
          completed_at: data.follow_up.completed_at,
          labels: data.follow_up.labels || [],
          external_issue_reference: data.follow_up.external_issue_reference
            ? {
                provider: data.follow_up.external_issue_reference.provider,
                issue_name: data.follow_up.external_issue_reference.issue_name,
                issue_permalink: data.follow_up.external_issue_reference.issue_permalink,
              }
            : undefined,
        },
      },
    }
  },

  outputs: {
    follow_up: {
      type: 'object',
      description: 'Follow-up details',
      properties: {
        id: { type: 'string', description: 'Follow-up ID' },
        title: { type: 'string', description: 'Follow-up title' },
        description: { type: 'string', description: 'Follow-up description' },
        assignee: {
          type: 'object',
          description: 'Assigned user',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        status: { type: 'string', description: 'Follow-up status' },
        priority: {
          type: 'object',
          description: 'Follow-up priority',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Priority ID' },
            name: { type: 'string', description: 'Priority name' },
            description: { type: 'string', description: 'Priority description' },
            rank: { type: 'number', description: 'Priority rank' },
          },
        },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        incident_id: { type: 'string', description: 'Associated incident ID' },
        creator: {
          type: 'object',
          description: 'User who created the follow-up',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        completed_at: { type: 'string', description: 'Completion timestamp' },
        labels: {
          type: 'array',
          description: 'Labels associated with the follow-up',
          items: { type: 'string' },
        },
        external_issue_reference: {
          type: 'object',
          description: 'External issue tracking reference',
          properties: {
            provider: { type: 'string', description: 'External provider name' },
            issue_name: { type: 'string', description: 'External issue name or ID' },
            issue_permalink: { type: 'string', description: 'Permalink to external issue' },
          },
        },
      },
    },
  },
}
