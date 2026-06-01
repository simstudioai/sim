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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time in epoch milliseconds (e.g., 1704067200000)',
    },
    to: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time in epoch milliseconds (e.g., 1704153600000)',
    },
    dashboardUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Dashboard UID to query annotations from (e.g., abc123def). Omit to query annotations across the organization.',
    },
    dashboardId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Legacy numeric dashboard ID filter (prefer dashboardUid)',
    },
    panelId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by panel ID (e.g., 1, 2)',
    },
    alertId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by alert ID',
    },
    userId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by ID of the user who created the annotation',
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
      if (params.dashboardId) searchParams.set('dashboardId', String(params.dashboardId))
      if (params.panelId) searchParams.set('panelId', String(params.panelId))
      if (params.alertId) searchParams.set('alertId', String(params.alertId))
      if (params.userId) searchParams.set('userId', String(params.userId))
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
    const rawAnnotations = Array.isArray(data) ? data.flat() : []

    return {
      success: true,
      output: {
        annotations: rawAnnotations.map((a: Record<string, unknown>) => ({
          id: (a.id as number) ?? null,
          alertId: (a.alertId as number) ?? null,
          dashboardId: (a.dashboardId as number) ?? null,
          dashboardUID: (a.dashboardUID as string) ?? null,
          panelId: (a.panelId as number) ?? null,
          userId: (a.userId as number) ?? null,
          userName: (a.userName as string) ?? null,
          newState: (a.newState as string) ?? null,
          prevState: (a.prevState as string) ?? null,
          time: (a.time as number) ?? null,
          timeEnd: (a.timeEnd as number) ?? null,
          text: (a.text as string) ?? null,
          metric: (a.metric as string) ?? null,
          tags: (a.tags as string[]) ?? [],
          data: (a.data as Record<string, unknown>) ?? {},
        })),
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
          alertId: { type: 'number', description: 'Associated alert ID (0 if not alert-driven)' },
          dashboardId: { type: 'number', description: 'Dashboard ID', optional: true },
          dashboardUID: { type: 'string', description: 'Dashboard UID', optional: true },
          panelId: { type: 'number', description: 'Panel ID within the dashboard', optional: true },
          userId: { type: 'number', description: 'ID of the user who created the annotation' },
          userName: {
            type: 'string',
            description: 'Username of the user who created the annotation',
            optional: true,
          },
          newState: {
            type: 'string',
            description: 'New alert state (alert annotations only)',
            optional: true,
          },
          prevState: {
            type: 'string',
            description: 'Previous alert state (alert annotations only)',
            optional: true,
          },
          time: { type: 'number', description: 'Start time in epoch ms' },
          timeEnd: { type: 'number', description: 'End time in epoch ms', optional: true },
          text: { type: 'string', description: 'Annotation text' },
          metric: {
            type: 'string',
            description: 'Metric associated with the annotation',
            optional: true,
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Annotation tags' },
          data: { type: 'json', description: 'Additional annotation data object from Grafana' },
        },
      },
    },
  },
}
