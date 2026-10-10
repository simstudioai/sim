import {
  type CheckrReportTagParams,
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
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrAddReportTagTool: ToolConfig<CheckrReportTagParams, CheckrReportTagsResponse> = {
  id: 'checkr_add_report_tag',
  name: 'Checkr Add Report Tag',
  description: 'Add a tag to a report, keeping its existing tags.',
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
    tag: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag to add, e.g. To Review',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/tags`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => ({ tag: trimmed(params.tag) }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapTags(data) }
  },

  outputs: TAGS_OUTPUTS,
}
