import type {
  GrafanaDataSourceHealthParams,
  GrafanaDataSourceHealthResponse,
} from '@/tools/grafana/types'
import type { InternalToolConfig } from '@/tools/types'

export const checkDataSourceHealthTool: InternalToolConfig<
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

  operation: {
    input: (params) => ({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      dataSourceUid: params.dataSourceUid,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as {
      success?: boolean
      output?: { status?: string; message?: string | null; details?: unknown }
      error?: string
    }

    if (!response.ok || data.success === false || !data.output) {
      throw new Error(data.error || `Grafana health check failed: HTTP ${response.status}`)
    }

    return {
      success: true,
      output: {
        status: data.output.status ?? 'UNKNOWN',
        message: data.output.message ?? null,
        ...(data.output.details === undefined ? {} : { details: data.output.details }),
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description:
        'Verdict Grafana returned for the data source, e.g. OK or ERROR. An unhealthy source reports here rather than failing the tool',
    },
    message: {
      type: 'string',
      description: "The plugin's diagnostic detail, which carries the reason on a failed check",
      nullable: true,
    },
    details: {
      type: 'json',
      description: 'Extra structured detail, when the data source plugin supplies any',
      optional: true,
    },
  },
}
