import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  authParams,
  displayValueParam,
  fieldsParam,
  recordIdentifierParams,
  recordOutputs,
} from '@/tools/servicenow/params'
import type {
  ServiceNowGetChangeParams,
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

export const getChangeRequestTool: ToolConfig<
  ServiceNowGetChangeParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_get_change_request',
  name: 'Get ServiceNow Change Request',
  description:
    'Retrieve a single ServiceNow change request by number (e.g., CHG0030001) or sys_id. Reference fields are returned with both their sys_id and their label by default.',
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
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.CHANGE_REQUEST}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
