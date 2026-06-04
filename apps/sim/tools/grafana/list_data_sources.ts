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
          ? data.map((ds: Record<string, unknown>) => ({
              id: (ds.id as number) ?? null,
              uid: (ds.uid as string) ?? null,
              orgId: (ds.orgId as number) ?? null,
              name: (ds.name as string) ?? null,
              type: (ds.type as string) ?? null,
              typeLogoUrl: (ds.typeLogoUrl as string) ?? null,
              access: (ds.access as string) ?? null,
              url: (ds.url as string) ?? null,
              user: (ds.user as string) ?? null,
              database: (ds.database as string) ?? null,
              basicAuth: (ds.basicAuth as boolean) ?? false,
              basicAuthUser: (ds.basicAuthUser as string) ?? null,
              withCredentials: (ds.withCredentials as boolean) ?? null,
              isDefault: (ds.isDefault as boolean) ?? false,
              jsonData: (ds.jsonData as Record<string, unknown>) ?? {},
              secureJsonFields: (ds.secureJsonFields as Record<string, boolean>) ?? {},
              version: (ds.version as number) ?? null,
              readOnly: (ds.readOnly as boolean) ?? false,
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
          orgId: { type: 'number', description: 'Organization ID' },
          name: { type: 'string', description: 'Data source name' },
          type: { type: 'string', description: 'Data source type (prometheus, mysql, etc.)' },
          typeLogoUrl: { type: 'string', description: 'Logo URL for the data source type' },
          access: { type: 'string', description: 'Access mode (proxy or direct)' },
          url: { type: 'string', description: 'Data source URL' },
          user: { type: 'string', description: 'Username used to connect' },
          database: { type: 'string', description: 'Database name (if applicable)' },
          basicAuth: { type: 'boolean', description: 'Whether basic auth is enabled' },
          basicAuthUser: {
            type: 'string',
            description: 'Basic auth username',
            optional: true,
          },
          withCredentials: {
            type: 'boolean',
            description: 'Whether to send credentials with cross-origin requests',
            optional: true,
          },
          isDefault: { type: 'boolean', description: 'Whether this is the default data source' },
          jsonData: { type: 'object', description: 'Type-specific JSON configuration' },
          secureJsonFields: {
            type: 'object',
            description: 'Map of secure fields that are set (values are not returned)',
            optional: true,
          },
          version: { type: 'number', description: 'Data source version', optional: true },
          readOnly: { type: 'boolean', description: 'Whether the data source is read-only' },
        },
      },
    },
  },
}
