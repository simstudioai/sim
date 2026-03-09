import type {
  GrafanaDeleteAnnotationParams,
  GrafanaDeleteAnnotationResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
