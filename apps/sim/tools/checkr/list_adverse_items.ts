import {
  ADVERSE_ITEMS_OUTPUT,
  type CheckrListAdverseItemsResponse,
  type CheckrReportIdParams,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapAdverseItems,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListAdverseItemsTool: ToolConfig<
  CheckrReportIdParams,
  CheckrListAdverseItemsResponse
> = {
  id: 'checkr_list_adverse_items',
  name: 'Checkr List Adverse Items',
  description:
    'List the adverse items on a report that can be cited in an adverse action. The report must have a consider result and no active adverse action.',
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
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/adverse_items`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        adverseItems: mapAdverseItems(data.data),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    adverseItems: ADVERSE_ITEMS_OUTPUT,
    count: { type: 'number', description: 'Number of adverse items', nullable: true },
  },
}
