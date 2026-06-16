import type {
  GrafanaDataSourceHealthParams,
  GrafanaDataSourceHealthResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const checkDataSourceHealthTool: ToolConfig<
  GrafanaDataSourceHealthParams,
  GrafanaDataSourceHealthResponse
> = {
  id: 'grafana_check_data_source_health',
  name: 'Grafana Check Data Source Health',
  description: 'Test connectivity to a data source by its UID',
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
    dataSourceUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the data source to health-check (e.g., P1234AB5678)',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/datasources/uid/${params.dataSourceUid.trim()}/health`,
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
        status: (data.status as string) ?? 'UNKNOWN',
        message: (data.message as string) ?? '',
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Health status of the data source (e.g., OK)' },
    message: { type: 'string', description: 'Detailed health message from the data source' },
  },
}
