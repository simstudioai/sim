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
      return { report_id: params.reportId }
    },
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
