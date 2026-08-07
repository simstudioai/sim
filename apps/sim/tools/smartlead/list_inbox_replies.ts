import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadBaseParams, SmartleadPaginatedRowsResponse } from '@/tools/smartlead/types'
import {
  jsonBody,
  opaqueRows,
  paginatedRowsOutputs,
  smartleadBaseParamFields,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Smartlead rejects every campaign-filter key this endpoint might plausibly take
 * (`campaign_id`, `campaign_ids`, `campaignIds`), so only pagination is offered.
 */
interface ListInboxRepliesParams extends SmartleadBaseParams {
  offset?: number
  limit?: number
  unreadOnly?: boolean
}

export const listInboxRepliesTool: ToolConfig<
  ListInboxRepliesParams,
  SmartleadPaginatedRowsResponse
> = {
  id: 'smartlead_list_inbox_replies',
  name: 'Smartlead List Inbox Replies',
  description:
    'Retrieves replies from the Smartlead master inbox across all campaigns, optionally limited to unread replies. Smartlead exposes no campaign filter on this endpoint.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    unreadOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only unread replies',
    },
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
      description: 'Replies to return per page',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(
        params.unreadOnly ? '/master-inbox/unread-replies' : '/master-inbox/inbox-replies',
        params.apiKey
      ),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) =>
      jsonBody({
        offset: params.offset ?? 0,
        limit: params.limit,
      }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'inbox replies')
    const rows = opaqueRows(record.data)

    return {
      success: true,
      output: {
        rows,
        count: rows.length,
        has_more: null,
        offset: typeof record.offset === 'number' ? record.offset : null,
        limit: typeof record.limit === 'number' ? record.limit : null,
      },
    }
  },
  outputs: paginatedRowsOutputs,
}
