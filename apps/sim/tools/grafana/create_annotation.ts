import type {
  GrafanaCreateAnnotationParams,
  GrafanaCreateAnnotationResponse,
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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'UID of the dashboard to add the annotation to (e.g., abc123def)',
    },
    panelId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the panel to add the annotation to (e.g., 1, 2)',
    },
    time: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time in epoch milliseconds (e.g., 1704067200000, defaults to now)',
    },
    timeEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time in epoch milliseconds for range annotations (e.g., 1704153600000)',
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
