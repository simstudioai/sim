import type {
  GrafanaCreateAnnotationParams,
  GrafanaCreateAnnotationResponse,
  GrafanaDeleteAnnotationParams,
  GrafanaDeleteAnnotationResponse,
  GrafanaListAnnotationsParams,
  GrafanaListAnnotationsResponse,
  GrafanaUpdateAnnotationParams,
  GrafanaUpdateAnnotationResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const createAnnotationTool: ToolConfig<
  GrafanaCreateAnnotationParams,
  GrafanaCreateAnnotationResponse
> = {
  id: 'grafana_create_annotation',
  name: 'Grafana Create Annotation',
  description: 'Create an annotation on a dashboard or as a global annotation',
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
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of the annotation',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags',
    },
    dashboardUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UID of the dashboard to add the annotation to (optional for global annotations)',
    },
    panelId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the panel to add the annotation to',
    },
    time: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time in epoch milliseconds (defaults to now)',
    },
    timeEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time in epoch milliseconds (for range annotations)',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/annotations`,
    method: 'POST',
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
    body: (params) => {
      const body: Record<string, any> = {
        text: params.text,
        time: params.time || Date.now(),
      }

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
      }

      if (params.dashboardUid) {
        body.dashboardUID = params.dashboardUid
      }

      if (params.panelId) {
        body.panelId = params.panelId
      }

      if (params.timeEnd) {
        body.timeEnd = params.timeEnd
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        message: data.message || 'Annotation created successfully',
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'The ID of the created annotation',
    },
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}

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

export const updateAnnotationTool: ToolConfig<
  GrafanaUpdateAnnotationParams,
  GrafanaUpdateAnnotationResponse
> = {
  id: 'grafana_update_annotation',
  name: 'Grafana Update Annotation',
  description: 'Update an existing annotation',
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
    annotationId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the annotation to update',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New text content for the annotation',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of new tags',
    },
    time: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start time in epoch milliseconds',
    },
    timeEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end time in epoch milliseconds',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/annotations/${params.annotationId}`,
    method: 'PATCH',
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
    body: (params) => {
      const body: Record<string, any> = {
        text: params.text,
      }

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
      }

      if (params.time) {
        body.time = params.time
      }

      if (params.timeEnd) {
        body.timeEnd = params.timeEnd
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id || 0,
        message: data.message || 'Annotation updated successfully',
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'The ID of the updated annotation',
    },
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}

export const deleteAnnotationTool: ToolConfig<
  GrafanaDeleteAnnotationParams,
  GrafanaDeleteAnnotationResponse
> = {
  id: 'grafana_delete_annotation',
  name: 'Grafana Delete Annotation',
  description: 'Delete an annotation by its ID',
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
    annotationId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the annotation to delete',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/annotations/${params.annotationId}`,
    method: 'DELETE',
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
        message: data.message || 'Annotation deleted successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}
