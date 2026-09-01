import type {
  GrafanaQueryDataSourceParams,
  GrafanaQueryDataSourceResponse,
  GrafanaQuerySeries,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

interface QueryFrameField {
  name?: string
  type?: string
}

interface QueryFrame {
  schema?: { refId?: string; fields?: QueryFrameField[] }
  data?: { values?: unknown[][] }
}

/**
 * Flattens Grafana's columnar frames into row objects.
 *
 * A frame carries `schema.fields[]` alongside `data.values[]`, where
 * `values[i]` is the whole column for `fields[i]`. Zipping them by position is
 * mechanically derived from that documented layout, so nothing here depends on
 * knowing a particular data source's field names.
 */
function flattenFrames(results: Record<string, { frames?: QueryFrame[] }>): GrafanaQuerySeries[] {
  const series: GrafanaQuerySeries[] = []

  for (const [refId, result] of Object.entries(results)) {
    for (const frame of result?.frames ?? []) {
      const fields = (frame.schema?.fields ?? []).map((field) => ({
        name: field.name ?? '',
        type: field.type ?? null,
      }))
      const columns = frame.data?.values ?? []
      const rowCount = columns.reduce((max, column) => Math.max(max, column?.length ?? 0), 0)

      const rows: Record<string, unknown>[] = []
      for (let row = 0; row < rowCount; row++) {
        const record: Record<string, unknown> = {}
        fields.forEach((field, index) => {
          if (field.name) record[field.name] = columns[index]?.[row] ?? null
        })
        rows.push(record)
      }

      series.push({
        refId: frame.schema?.refId ?? refId,
        fields,
        rowCount,
        rows,
      })
    }
  }

  return series
}

export const queryDataSourceTool: ToolConfig<
  GrafanaQueryDataSourceParams,
  GrafanaQueryDataSourceResponse
> = {
  id: 'grafana_query_data_source',
  name: 'Grafana Query Data Source',
  description:
    'Run one or more queries against a Grafana data source that has a backend implementation, and read the values back. This is how you get actual metric numbers out of Grafana rather than dashboard or alert configuration.',
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
    queries: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of at least one query. Each needs a datasource.uid and a refId, plus the fields that data source expects — expr for Prometheus, rawSql for SQL. Example: [{"refId":"A","datasource":{"uid":"P123"},"expr":"up","format":"time_series"}]',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the time range, either epoch milliseconds or Grafana relative time (e.g., now-5m). Defaults to now-1h',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the time range, epoch milliseconds or relative (e.g., now)',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/ds/query`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      return headers
    },
    body: (params) => {
      let queries: unknown
      try {
        queries = JSON.parse(params.queries)
      } catch {
        throw new Error('Invalid JSON for queries parameter')
      }
      if (!Array.isArray(queries) || queries.length === 0) {
        throw new Error('queries must be a JSON array with at least one query')
      }

      return {
        queries,
        from: params.from?.trim() || 'now-1h',
        to: params.to?.trim() || 'now',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as {
      results?: Record<string, { frames?: QueryFrame[] }>
    }
    const results = data.results ?? {}

    return {
      success: true,
      output: {
        results,
        series: flattenFrames(results),
      },
    }
  },

  outputs: {
    results: {
      type: 'json',
      description:
        'Raw Grafana response, keyed by each query refId, each holding the frames that query produced',
    },
    series: {
      type: 'array',
      description:
        'The same frames flattened into rows, so values can be read without walking the columnar layout',
      items: {
        type: 'object',
        properties: {
          refId: { type: 'string', description: 'The query this frame came from' },
          fields: {
            type: 'array',
            description: 'Field metadata in column order',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name, e.g. time or A-series' },
                type: {
                  type: 'string',
                  description: 'Field type, e.g. time or number',
                  nullable: true,
                },
              },
            },
          },
          rowCount: { type: 'number', description: 'Number of rows in the frame' },
          rows: {
            type: 'array',
            description: 'Rows keyed by field name',
            items: { type: 'object' },
          },
        },
      },
    },
  },
}
