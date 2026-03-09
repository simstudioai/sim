import type {
  GrafanaListDataSourcesParams,
  GrafanaListDataSourcesResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const listDataSourcesTool: ToolConfig<
  GrafanaListDataSourcesParams,
  GrafanaListDataSourcesResponse
> = {
  id: 'grafana_list_data_sources',
  name: 'Grafana List Data Sources',
  description: 'List all data sources configured in Grafana',
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
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/datasources`,
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
        dataSources: Array.isArray(data)
          ? data.map((ds: any) => ({
              id: ds.id,
              uid: ds.uid,
              orgId: ds.orgId,
              name: ds.name,
              type: ds.type,
              typeName: ds.typeName,
              typeLogoUrl: ds.typeLogoUrl,
              access: ds.access,
              url: ds.url,
              user: ds.user,
              database: ds.database,
              basicAuth: ds.basicAuth || false,
              isDefault: ds.isDefault || false,
              jsonData: ds.jsonData || {},
              readOnly: ds.readOnly || false,
            }))
          : [],
      },
    }
  },

  outputs: {
    dataSources: {
      type: 'array',
      description: 'List of data sources',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Data source ID' },
          uid: { type: 'string', description: 'Data source UID' },
          name: { type: 'string', description: 'Data source name' },
          type: { type: 'string', description: 'Data source type (prometheus, mysql, etc.)' },
          url: { type: 'string', description: 'Data source URL' },
          isDefault: { type: 'boolean', description: 'Whether this is the default data source' },
        },
      },
    },
  },
}
