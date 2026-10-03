import {
  POWERBI_REPORT_OUTPUT_PROPERTIES,
  type PowerBIGetReportParams,
  type PowerBIGetReportResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBIHeaders,
  powerBIUrl,
  projectPowerBIReport,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiGetReportTool: ToolConfig<PowerBIGetReportParams, PowerBIGetReportResponse> = {
  id: 'powerbi_get_report',
  name: 'Power BI Get Report',
  description: 'Get report metadata from a Power BI workspace.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    groupId: POWERBI_GROUP_ID_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Power BI report ID',
    },
  },
  request: {
    url: (params) => powerBIUrl(['groups', params.groupId, 'reports', params.reportId]),
    method: 'GET',
    headers: (params) => powerBIHeaders(params.accessToken),
  },
  transformResponse: async (response, _params, context) => ({
    success: true,
    output: { report: projectPowerBIReport(await readPowerBIJson(response, context?.signal)) },
  }),
  outputs: {
    report: {
      type: 'object',
      description: 'Report metadata; unavailable fields are null',
      properties: POWERBI_REPORT_OUTPUT_PROPERTIES,
    },
  },
}
