import type { RipplingTriggerReportRunParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingTriggerReportRunTool: ToolConfig<RipplingTriggerReportRunParams> = {
  id: 'rippling_trigger_report_run',
  name: 'Rippling Trigger Report Run',
  description: 'Trigger a new report run',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Report ID to run',
    },
    includeObjectIds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include object IDs in the report',
    },
    includeTotalRows: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include total row count',
    },
    formatDateFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date field formatting configuration',
    },
    formatCurrencyFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency field formatting configuration',
    },
    outputType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output type (JSON or CSV)',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/report-runs/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { report_id: params.reportId }
      if (params.includeObjectIds != null) body.include_object_ids = params.includeObjectIds
      if (params.includeTotalRows != null) body.include_total_rows = params.includeTotalRows
      if (params.formatDateFields != null) body.format_date_fields = params.formatDateFields
      if (params.formatCurrencyFields != null)
        body.format_currency_fields = params.formatCurrencyFields
      if (params.outputType != null) body.output_type = params.outputType
      return body
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    const result = data.result as Record<string, unknown> | null
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        report_id: (data.report_id as string) ?? null,
        status: (data.status as string) ?? null,
        file_url: (result?.file_url as string) ?? null,
        expires_at: (result?.expires_at as string) ?? null,
        output_type: (result?.output_type as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Report run ID' },
    report_id: { type: 'string', description: 'Report ID', optional: true },
    status: { type: 'string', description: 'Run status', optional: true },
    file_url: { type: 'string', description: 'URL to download the report file', optional: true },
    expires_at: {
      type: 'string',
      description: 'Expiration timestamp for the file URL',
      optional: true,
    },
    output_type: { type: 'string', description: 'Output format (JSON or CSV)', optional: true },
  },
}
