import {
  type CheckrReportIdParams,
  type CheckrReportResponse,
  REPORT_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapReport,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCompleteReportTool: ToolConfig<CheckrReportIdParams, CheckrReportResponse> = {
  id: 'checkr_complete_report',
  name: 'Checkr Complete Report',
  description:
    'Complete a report now, canceling any pending or suspended screenings. Canceled screenings record a cancellation reason.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report to complete',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/complete`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { report: mapReport(data) } }
  },

  outputs: {
    report: { type: 'object', description: 'The completed report', properties: REPORT_PROPERTIES },
  },
}
