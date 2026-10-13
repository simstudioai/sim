import {
  type CheckrReportIdParams,
  type CheckrReportTagsResponse,
  TAGS_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapTags,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetReportTagsTool: ToolConfig<CheckrReportIdParams, CheckrReportTagsResponse> = {
  id: 'checkr_get_report_tags',
  name: 'Checkr Get Report Tags',
  description: 'List the tags on a report.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/tags`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapTags(data) }
  },

  outputs: TAGS_OUTPUTS,
}
