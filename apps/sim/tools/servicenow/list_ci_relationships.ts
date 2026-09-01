import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListCiRelationshipsParams,
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

export const listCiRelationshipsTool: ToolConfig<
  ServiceNowListCiRelationshipsParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_ci_relationships',
  name: 'List ServiceNow CI Relationships',
  description:
    'List rows from the CI Relationship [cmdb_rel_ci] table for a configuration item. Each row carries the parent CI, the child CI, and the relationship type.',
  version: '1.0.0',

  params: {
    ...authParams,
    ciSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the configuration item whose relationships should be listed.',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which side of the relationship the CI sits on: "parent", "child", or "both" (default). "both" matches rows where the CI is either the parent or the child.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const ciSysId = params.ciSysId?.trim()
      if (!ciSysId) {
        throw new Error('A configuration item sys_id is required')
      }

      const direction = params.direction?.trim().toLowerCase() || 'both'
      let directionQuery: string
      if (direction === 'parent') {
        directionQuery = `parent=${ciSysId}`
      } else if (direction === 'child') {
        directionQuery = `child=${ciSysId}`
      } else {
        directionQuery = `parent=${ciSysId}^ORchild=${ciSysId}`
      }

      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query: buildEncodedQuery([], [directionQuery, params.query].filter(Boolean).join('^')),
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.CI_RELATIONSHIP}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
