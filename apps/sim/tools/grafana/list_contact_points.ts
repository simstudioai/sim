import type {
  GrafanaListContactPointsParams,
  GrafanaListContactPointsResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const listContactPointsTool: ToolConfig<
  GrafanaListContactPointsParams,
  GrafanaListContactPointsResponse
> = {
  id: 'grafana_list_contact_points',
  name: 'Grafana List Contact Points',
  description: 'List all alert notification contact points',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana Service Account Token',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana instance URL (e.g., https://your-grafana.com)',
    },
    organizationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/v1/provisioning/contact-points`,
    method: 'GET',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        contactPoints: Array.isArray(data)
          ? data.map((cp: any) => ({
              uid: cp.uid,
              name: cp.name,
              type: cp.type,
              settings: cp.settings || {},
              disableResolveMessage: cp.disableResolveMessage || false,
              provenance: cp.provenance || '',
            }))
          : [],
      },
    }
  },

  outputs: {
    contactPoints: {
      type: 'array',
      description: 'List of contact points',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Contact point UID' },
          name: { type: 'string', description: 'Contact point name' },
          type: { type: 'string', description: 'Notification type (email, slack, etc.)' },
          settings: { type: 'object', description: 'Type-specific settings' },
        },
      },
    },
  },
}
