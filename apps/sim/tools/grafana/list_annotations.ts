import type {
  GrafanaListAnnotationsParams,
  GrafanaListAnnotationsResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const listAnnotationsTool: ToolConfig<
  GrafanaListAnnotationsParams,
  GrafanaListAnnotationsResponse
> = {
  id: 'grafana_list_annotations',
  name: 'Grafana List Annotations',
  description: 'Query annotations by time range, dashboard, or tags',
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time in epoch milliseconds',
    },
    to: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time in epoch milliseconds',
    },
    dashboardUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by dashboard UID',
    },
    panelId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by panel ID',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags to filter by',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by type (alert or annotation)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of annotations to return',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const searchParams = new URLSearchParams()

      if (params.from) searchParams.set('from', String(params.from))
      if (params.to) searchParams.set('to', String(params.to))
      if (params.dashboardUid) searchParams.set('dashboardUID', params.dashboardUid)
      if (params.panelId) searchParams.set('panelId', String(params.panelId))
      if (params.tags) {
        params.tags.split(',').forEach((t) => searchParams.append('tags', t.trim()))
      }
      if (params.type) searchParams.set('type', params.type)
      if (params.limit) searchParams.set('limit', String(params.limit))

      const queryString = searchParams.toString()
      return `${baseUrl}/api/annotations${queryString ? `?${queryString}` : ''}`
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
        annotations: Array.isArray(data)
          ? data.map((a: any) => ({
              id: a.id,
              alertId: a.alertId,
              alertName: a.alertName,
              dashboardId: a.dashboardId,
              dashboardUID: a.dashboardUID,
              panelId: a.panelId,
              userId: a.userId,
              newState: a.newState,
              prevState: a.prevState,
              created: a.created,
              updated: a.updated,
              time: a.time,
              timeEnd: a.timeEnd,
              text: a.text,
              tags: a.tags || [],
              login: a.login,
              email: a.email,
              avatarUrl: a.avatarUrl,
              data: a.data,
            }))
          : [],
      },
    }
  },

  outputs: {
    annotations: {
      type: 'array',
      description: 'List of annotations',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Annotation ID' },
          text: { type: 'string', description: 'Annotation text' },
          tags: { type: 'array', description: 'Annotation tags' },
          time: { type: 'number', description: 'Start time in epoch ms' },
          timeEnd: { type: 'number', description: 'End time in epoch ms' },
          dashboardUID: { type: 'string', description: 'Dashboard UID' },
          panelId: { type: 'number', description: 'Panel ID' },
        },
      },
    },
  },
}
