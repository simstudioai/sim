import type { GrafanaHealthCheckParams, GrafanaHealthCheckResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const healthCheckTool: ToolConfig<GrafanaHealthCheckParams, GrafanaHealthCheckResponse> = {
  id: 'grafana_health_check',
  name: 'Grafana Health Check',
  description: 'Check the health status of a Grafana instance',
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
        commit: data.commit || '',
        database: data.database || 'ok',
        version: data.version || '',
      },
    }
  },

  outputs: {
    commit: {
      type: 'string',
      description: 'Git commit hash of the Grafana build',
    },
    database: {
      type: 'string',
      description: 'Database connection status (ok or failing)',
    },
    version: {
      type: 'string',
      description: 'Grafana version number',
    },
  },
}
