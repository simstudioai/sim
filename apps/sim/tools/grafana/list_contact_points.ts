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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter contact points by exact name match',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const searchParams = new URLSearchParams()
      if (params.name) searchParams.set('name', params.name)
      const queryString = searchParams.toString()
      return `${baseUrl}/api/v1/provisioning/contact-points${queryString ? `?${queryString}` : ''}`
    },
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
          ? data.map((cp: Record<string, unknown>) => ({
              uid: (cp.uid as string) ?? null,
              name: (cp.name as string) ?? null,
              type: (cp.type as string) ?? null,
              settings: (cp.settings as Record<string, unknown>) ?? {},
              disableResolveMessage: (cp.disableResolveMessage as boolean) ?? false,
              provenance: (cp.provenance as string) ?? '',
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
          disableResolveMessage: {
            type: 'boolean',
            description: 'Whether resolve messages are disabled',
          },
          provenance: {
            type: 'string',
            description: 'Provisioning source (empty if API-managed)',
          },
        },
      },
    },
  },
}
