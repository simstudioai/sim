import type {
  IncidentioFollowUpsListParams,
  IncidentioFollowUpsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const followUpsListTool: ToolConfig<
  IncidentioFollowUpsListParams,
  IncidentioFollowUpsListResponse
> = {
  id: 'incidentio_follow_ups_list',
  name: 'incident.io Follow-ups List',
  description: 'List follow-ups from incident.io. Optionally filter by incident ID.',
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
      description: 'Filter follow-ups by incident ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of follow-ups to return per page (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/follow_ups')

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
        follow_ups:
          data.follow_ups?.map((followUp: any) => ({
            id: followUp.id,
            title: followUp.title || '',
            description: followUp.description,
            assignee: followUp.assignee
              ? {
                  id: followUp.assignee.id,
                  name: followUp.assignee.name,
                  email: followUp.assignee.email,
                }
              : undefined,
            status: followUp.status,
            priority: followUp.priority
              ? {
                  id: followUp.priority.id,
                  name: followUp.priority.name,
                  description: followUp.priority.description,
                  rank: followUp.priority.rank,
                }
              : undefined,
            created_at: followUp.created_at,
            updated_at: followUp.updated_at,
            incident_id: followUp.incident_id,
            creator: followUp.creator
              ? {
                  id: followUp.creator.id,
                  name: followUp.creator.name,
                  email: followUp.creator.email,
                }
              : undefined,
            completed_at: followUp.completed_at,
            labels: followUp.labels || [],
            external_issue_reference: followUp.external_issue_reference
              ? {
                  provider: followUp.external_issue_reference.provider,
                  issue_name: followUp.external_issue_reference.issue_name,
                  issue_permalink: followUp.external_issue_reference.issue_permalink,
                }
              : undefined,
          })) || [],
      },
    }
  },

  outputs: {
    follow_ups: {
      type: 'array',
      description: 'List of follow-ups',
      items: {
        type: 'object',
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
  },
}
