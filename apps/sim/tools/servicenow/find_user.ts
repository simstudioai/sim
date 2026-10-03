import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowFindUserParams,
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

export const findUserTool: ToolConfig<ServiceNowFindUserParams, ServiceNowRecordListResponse> = {
  id: 'servicenow_find_user',
  name: 'Find ServiceNow User',
  description:
    'Look up ServiceNow users by email, user name, or display name. Use this to resolve the sys_id needed by reference fields such as caller_id, assigned_to, and approver.',
  version: '1.0.0',

  params: {
    ...authParams,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact email address to match.',
    },
    userName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact user name (user_name) to match.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Text to match against the display name using the ServiceNow LIKE operator, which matches anywhere in the field.',
    },
    active: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to active ("true") or inactive ("false") users.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const query = buildEncodedQuery(
        [
          ['email', '=', params.email],
          ['user_name', '=', params.userName],
          ['name', 'LIKE', params.name],
          ['active', '=', params.active],
        ],
        params.query
      )

      if (!query) {
        throw new Error('At least one of email, userName, name, active, or query is required')
      }

      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query,
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(`${baseUrl}/api/now/table/${SERVICENOW_TABLES.USER}`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
