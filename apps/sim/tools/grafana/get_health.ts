import type { GrafanaHealthCheckParams, GrafanaHealthCheckResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const getHealthTool: ToolConfig<GrafanaHealthCheckParams, GrafanaHealthCheckResponse> = {
  id: 'grafana_get_health',
  name: 'Grafana Get Health',
  description: 'Check the health of the Grafana instance (version, database status)',
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
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/health`,
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
        commit: (data.commit as string) ?? '',
        database: (data.database as string) ?? '',
        version: (data.version as string) ?? '',
      },
    }
  },

  outputs: {
    commit: { type: 'string', description: 'Git commit hash of the running Grafana build' },
    database: { type: 'string', description: 'Database health status (e.g., ok)' },
    version: { type: 'string', description: 'Grafana version' },
  },
}
