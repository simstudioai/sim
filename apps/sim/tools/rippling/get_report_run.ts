import type { RipplingGetReportRunParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetReportRunTool: ToolConfig<RipplingGetReportRunParams> = {
  id: 'rippling_get_report_run',
  name: 'Rippling Get Report Run',
  description: 'Get a report run by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    runId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'run id' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/report-runs/${encodeURIComponent(params.runId.trim())}/`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        report_id: (data.report_id as string) ?? null,
        status: (data.status as string) ?? null,
        result: data.result ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Report run ID' },
    report_id: { type: 'string', description: 'Report ID', optional: true },
    status: { type: 'string', description: 'Run status', optional: true },
    result: {
      type: 'json',
      description: 'Report result (file_url, expires_at, output_type)',
      optional: true,
    },
  },
}
