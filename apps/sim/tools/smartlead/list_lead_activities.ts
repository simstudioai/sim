import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadPaginatedRowsResponse } from '@/tools/smartlead/types'
import {
  opaqueRows,
  paginatedRowsOutputs,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Smartlead exposes no working campaign filter on this endpoint — `campaign_id`,
 * `campaignId`, `campaign_ids` and `email_campaign_id` are all rejected by its
 * validator, so only pagination is offered.
 */
interface ListLeadActivitiesParams extends SmartleadBaseParams {
  offset?: number
  limit?: number
}

export const listLeadActivitiesTool: ToolConfig<
  ListLeadActivitiesParams,
  SmartleadPaginatedRowsResponse
> = {
  id: 'smartlead_list_lead_activities',
  name: 'Smartlead List Lead Activities',
  description:
    'Retrieves recent lead activity across all Smartlead campaigns — opens, clicks, replies, and status changes. Smartlead exposes no campaign filter on this endpoint.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset (default 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return per page',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl('/campaigns/all-leads-activities', params.apiKey, {
        offset: params.offset,
        limit: params.limit,
      }),
    method: 'GET',
    headers: smartleadHeaders,
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'lead activities')
    const rows = opaqueRows(record.data)
    const pagination = isRecordLike(record.pagination) ? record.pagination : {}

    return {
      success: true,
      output: {
        rows,
        count: rows.length,
        has_more: typeof pagination.has_more === 'boolean' ? pagination.has_more : null,
        offset: typeof pagination.offset === 'number' ? pagination.offset : null,
        limit: typeof pagination.limit === 'number' ? pagination.limit : null,
      },
    }
  },
  outputs: paginatedRowsOutputs,
}
