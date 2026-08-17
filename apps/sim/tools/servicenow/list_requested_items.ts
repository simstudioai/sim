import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListRequestedItemsParams,
  ServiceNowRecordListResponse,
} from '@/tools/servicenow/types'
import {
  appendReadParams,
  buildEncodedQuery,
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  transformRecordListResponse,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const listRequestedItemsTool: ToolConfig<
  ServiceNowListRequestedItemsParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_requested_items',
  name: 'List ServiceNow Requested Items',
  description:
    'List requested items (RITMs) from the ServiceNow Requested Item [sc_req_item] table, optionally scoped to a parent request or a catalog item. To scope by requester, pass an encoded query against the parent request, for example "request.requested_for=<sys_id>".',
  version: '1.0.0',

  params: {
    ...authParams,
    requestSysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the parent request (sc_request) whose items should be listed.',
    },
    catalogItemSysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the catalog item (cat_item) to filter by.',
    },
    active: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to active ("true") or inactive ("false") requested items.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query: buildEncodedQuery(
          [
            ['request', '=', params.requestSysId],
            ['cat_item', '=', params.catalogItemSysId],
            ['active', '=', params.active],
          ],
          params.query
        ),
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.REQUESTED_ITEM}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
