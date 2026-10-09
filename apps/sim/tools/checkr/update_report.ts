import {
  type CheckrReportResponse,
  type CheckrUpdateReportParams,
  REPORT_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapReport,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrUpdateReportTool: ToolConfig<CheckrUpdateReportParams, CheckrReportResponse> = {
  id: 'checkr_update_report',
  name: 'Checkr Update Report',
  description:
    'Upgrade a report to a different package or mark it as engaged. Provide a package, an adjudication, or both.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report to update',
    },
    package: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slug of the package to upgrade the report to',
    },
    adjudication: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Adjudication to set; Checkr accepts only "engaged"',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const pkg = trimmed(params.package)
      const adjudication = trimmed(params.adjudication)
      if (pkg) body.package = pkg
      if (adjudication) body.adjudication = adjudication
      if (!pkg && !adjudication) {
        throw new Error('Provide a package or an adjudication to update the report.')
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { report: mapReport(data) } }
  },

  outputs: {
    report: { type: 'object', description: 'The updated report', properties: REPORT_PROPERTIES },
  },
}
