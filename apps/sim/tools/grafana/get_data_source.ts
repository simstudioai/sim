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
      // Check if it looks like a UID (contains non-numeric characters) or ID
      const isUid = /[^0-9]/.test(params.dataSourceId)
      if (isUid) {
        return `${baseUrl}/api/datasources/uid/${params.dataSourceId}`
      }
      return `${baseUrl}/api/datasources/${params.dataSourceId}`
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
        id: data.id,
        uid: data.uid,
        orgId: data.orgId,
        name: data.name,
        type: data.type,
        typeName: data.typeName,
        typeLogoUrl: data.typeLogoUrl,
        access: data.access,
        url: data.url,
        user: data.user,
        database: data.database,
        basicAuth: data.basicAuth || false,
        isDefault: data.isDefault || false,
        jsonData: data.jsonData || {},
        readOnly: data.readOnly || false,
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'Data source ID',
    },
    uid: {
      type: 'string',
      description: 'Data source UID',
    },
    name: {
      type: 'string',
      description: 'Data source name',
    },
    type: {
      type: 'string',
      description: 'Data source type',
    },
    url: {
      type: 'string',
      description: 'Data source connection URL',
    },
    database: {
      type: 'string',
      description: 'Database name (if applicable)',
    },
    isDefault: {
      type: 'boolean',
      description: 'Whether this is the default data source',
    },
    jsonData: {
      type: 'json',
      description: 'Additional data source configuration',
    },
  },
}
