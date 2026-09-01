import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListGroupMembersParams,
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

export const listGroupMembersTool: ToolConfig<
  ServiceNowListGroupMembersParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_group_members',
  name: 'List ServiceNow Group Members',
  description:
    'List the members of a ServiceNow group from the Group Member [sys_user_grmember] table. Each row links a user to a group, so use it to find who can be assigned work for an assignment group.',
  version: '1.0.0',

  params: {
    ...authParams,
    groupSysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the sys_user_group whose members should be listed.',
    },
    groupName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exact group name, resolved against the referenced group record. Provide this or the group sys_id.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const query = buildEncodedQuery(
        [
          ['group', '=', params.groupSysId],
          ['group.name', '=', params.groupName],
        ],
        params.query
      )

      if (!query) {
        throw new Error('Either a group sys_id or a group name is required')
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
      return withQueryString(
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.GROUP_MEMBER}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
