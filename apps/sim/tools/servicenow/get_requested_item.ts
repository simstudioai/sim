import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  authParams,
  displayValueParam,
  fieldsParam,
  recordIdentifierParams,
  recordOutputs,
} from '@/tools/servicenow/params'
import type {
  ServiceNowGetRequestedItemParams,
  ServiceNowSingleRecordResponse,
} from '@/tools/servicenow/types'
import {
  appendReadParams,
  buildIdentifierQuery,
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  transformRecordResponse,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const getRequestedItemTool: ToolConfig<
  ServiceNowGetRequestedItemParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_get_requested_item',
  name: 'Get ServiceNow Requested Item',
  description:
    'Retrieve a single ServiceNow requested item (RITM) by number (e.g., RITM0010001) or sys_id from the Requested Item [sc_req_item] table.',
  version: '1.0.0',

  params: {
    ...authParams,
    ...recordIdentifierParams,
    ...fieldsParam,
    ...displayValueParam,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query: buildIdentifierQuery(params),
        limit: 1,
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

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
