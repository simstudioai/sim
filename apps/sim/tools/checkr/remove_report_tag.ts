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

export const checkrRemoveReportTagTool: ToolConfig<
  CheckrReportTagParams,
  CheckrReportTagsResponse
> = {
  id: 'checkr_remove_report_tag',
  name: 'Checkr Remove Report Tag',
  description: 'Remove a tag from a report.',
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
      description: 'Tag to remove',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/tags`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => ({ tag: trimmed(params.tag) }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapTags(data) }
  },

  outputs: TAGS_OUTPUTS,
}
