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

export const checkrGetReportTool: ToolConfig<CheckrReportIdParams, CheckrReportResponse> = {
  id: 'checkr_get_report',
  name: 'Checkr Get Report',
  description:
    'Retrieve a report by ID, including its status, result, adjudication, and the IDs of each screening it ran.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report to retrieve',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { report: mapReport(data) } }
  },

  outputs: {
    report: { type: 'object', description: 'The report', properties: REPORT_PROPERTIES },
  },
}
