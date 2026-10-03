import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowRecordListResponse,
  ServiceNowSearchCisParams,
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

export const searchCisTool: ToolConfig<ServiceNowSearchCisParams, ServiceNowRecordListResponse> = {
  id: 'servicenow_search_cis',
  name: 'Search ServiceNow Configuration Items',
  description:
    'Search the ServiceNow CMDB for configuration items. Defaults to the base cmdb_ci table, which returns CIs of every class; pass a CI class to scope the search to a subclass such as cmdb_ci_linux_server.',
  version: '1.0.0',

  params: {
    ...authParams,
    ciClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `CMDB class (table) to search, e.g., cmdb_ci_linux_server or cmdb_ci_app_server. Defaults to ${SERVICENOW_TABLES.CI}, which covers every CI class.`,
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Text to match against the CI name using the ServiceNow LIKE operator, which matches anywhere in the field.',
    },
    operationalStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Operational status coded value (operational_status). The choice list is configured per instance.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const table = params.ciClass?.trim() || SERVICENOW_TABLES.CI
      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query: buildEncodedQuery(
          [
            ['name', 'LIKE', params.name],
            ['operational_status', '=', params.operationalStatus],
          ],
          params.query
        ),
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(`${baseUrl}/api/now/table/${table}`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
