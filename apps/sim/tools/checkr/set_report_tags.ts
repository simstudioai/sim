import {
  type CheckrReportTagsResponse,
  type CheckrSetReportTagsParams,
  TAGS_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapTags,
  parseCheckrStringList,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrSetReportTagsTool: ToolConfig<
  CheckrSetReportTagsParams,
  CheckrReportTagsResponse
> = {
  id: 'checkr_set_report_tags',
  name: 'Checkr Set Report Tags',
  description: 'Replace all tags on a report with the given list. Pass [] to remove every tag.',
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
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Complete list of tags, as an array or comma-separated list; [] removes every tag',
    },
  },

  request: {
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/tags`),
    method: 'PUT',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => ({ tags: parseCheckrStringList(params.tags) ?? [] }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapTags(data) }
  },

  outputs: TAGS_OUTPUTS,
}
