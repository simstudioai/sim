import type {
  GrafanaUpdateAnnotationParams,
  GrafanaUpdateAnnotationResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
      description: 'New start time in epoch milliseconds (e.g., 1704067200000)',
    },
    timeEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end time in epoch milliseconds (e.g., 1704153600000)',
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
