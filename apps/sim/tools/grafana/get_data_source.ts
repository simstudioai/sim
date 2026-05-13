import type {
  GrafanaGetDataSourceParams,
  GrafanaGetDataSourceResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const getDataSourceTool: ToolConfig<
  GrafanaGetDataSourceParams,
  GrafanaGetDataSourceResponse
> = {
  id: 'grafana_get_data_source',
  name: 'Grafana Get Data Source',
  description: 'Get a data source by its ID or UID',
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
    dataSourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID or UID of the data source to retrieve (e.g., prometheus, P1234AB5678)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const id = params.dataSourceId.trim()
      // Numeric DB id route only matches purely-numeric ids up to int64 length;
      // anything else is treated as a UID (Grafana UIDs are short slug strings).
      const isNumericId = /^\d+$/.test(id) && id.length <= 18
      if (isNumericId) {
        return `${baseUrl}/api/datasources/${id}`
      }
      return `${baseUrl}/api/datasources/uid/${id}`
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
        id: (data.id as number) ?? null,
        uid: (data.uid as string) ?? null,
        orgId: (data.orgId as number) ?? null,
        name: (data.name as string) ?? null,
        type: (data.type as string) ?? null,
        typeLogoUrl: (data.typeLogoUrl as string) ?? null,
        access: (data.access as string) ?? null,
        url: (data.url as string) ?? null,
        user: (data.user as string) ?? null,
        database: (data.database as string) ?? null,
        basicAuth: (data.basicAuth as boolean) ?? false,
        basicAuthUser: (data.basicAuthUser as string) ?? null,
        withCredentials: (data.withCredentials as boolean) ?? null,
        isDefault: (data.isDefault as boolean) ?? false,
        jsonData: (data.jsonData as Record<string, unknown>) ?? {},
        secureJsonFields: (data.secureJsonFields as Record<string, boolean>) ?? {},
        version: (data.version as number) ?? null,
        readOnly: (data.readOnly as boolean) ?? false,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Data source ID' },
    uid: { type: 'string', description: 'Data source UID' },
    orgId: { type: 'number', description: 'Organization ID' },
    name: { type: 'string', description: 'Data source name' },
    type: { type: 'string', description: 'Data source type' },
    typeLogoUrl: { type: 'string', description: 'Logo URL for the data source type' },
    access: { type: 'string', description: 'Access mode (proxy or direct)' },
    url: { type: 'string', description: 'Data source connection URL' },
    user: { type: 'string', description: 'Username used to connect' },
    database: { type: 'string', description: 'Database name (if applicable)' },
    basicAuth: { type: 'boolean', description: 'Whether basic auth is enabled' },
    basicAuthUser: { type: 'string', description: 'Basic auth username', optional: true },
    withCredentials: {
      type: 'boolean',
      description: 'Whether to send credentials with cross-origin requests',
      optional: true,
    },
    isDefault: { type: 'boolean', description: 'Whether this is the default data source' },
    jsonData: { type: 'json', description: 'Additional data source configuration' },
    secureJsonFields: {
      type: 'object',
      description: 'Map of secure fields that are set (values are not returned)',
      optional: true,
    },
    version: { type: 'number', description: 'Data source version', optional: true },
    readOnly: { type: 'boolean', description: 'Whether the data source is read-only' },
  },
}
