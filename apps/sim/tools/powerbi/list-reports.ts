import {
  POWERBI_REPORT_OUTPUT_PROPERTIES,
  type PowerBIGroupParams,
  type PowerBIListReportsResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBICollection,
  powerBIHeaders,
  powerBIUrl,
  projectPowerBIReport,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiListReportsTool: ToolConfig<PowerBIGroupParams, PowerBIListReportsResponse> = {
  id: 'powerbi_list_reports',
  name: 'Power BI List Reports',
  description: 'List reports in a Power BI workspace, including paginated reports.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: { accessToken: POWERBI_ACCESS_TOKEN_PARAM, groupId: POWERBI_GROUP_ID_PARAM },
  request: {
    url: (params) => powerBIUrl(['groups', params.groupId, 'reports']),
    method: 'GET',
    headers: (params) => powerBIHeaders(params.accessToken),
  },
  transformResponse: async (response, _params, context) => {
    const reports = powerBICollection(await readPowerBIJson(response, context?.signal)).map(
      projectPowerBIReport
    )
    return { success: true, output: { reports, reportCount: reports.length } }
  },
  outputs: {
    reports: {
      type: 'array',
      description: 'Reports in the workspace',
      items: { type: 'object', properties: POWERBI_REPORT_OUTPUT_PROPERTIES },
    },
    reportCount: { type: 'number', description: 'Number of reports returned' },
  },
}
