import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowChangeTaskListResponse,
  ServiceNowListChangeTasksParams,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordArray,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const listChangeTasksTool: ToolConfig<
  ServiceNowListChangeTasksParams,
  ServiceNowChangeTaskListResponse
> = {
  id: 'servicenow_list_change_tasks',
  name: 'List ServiceNow Change Tasks',
  description:
    'List the change tasks belonging to a ServiceNow change request, via the Change Management API. Every field is returned as {value, display_value}, so a reference field carries both its sys_id and its label. This endpoint is not the Table API: the shape is fixed with no display-value option, and the results come back under `tasks` rather than the `records` the other list operations use.',
  version: '1.0.0',

  params: {
    ...authParams,
    changeSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the change request whose tasks should be listed.',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ServiceNow encoded query used to filter the tasks (e.g., "active=true^ORDERBYnumber").',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort the returned tasks by.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tasks to return (sysparm_limit). ServiceNow defaults to 500.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tasks to skip for pagination (sysparm_offset).',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const changeSysId = params.changeSysId?.trim()
      if (!changeSysId) {
        throw new Error('A change request sys_id is required')
      }

      const searchParams = new URLSearchParams()
      if (params.query) searchParams.append('sysparm_query', params.query)
      if (params.order) searchParams.append('order', params.order)
      if (params.limit !== undefined && params.limit !== null) {
        searchParams.append('sysparm_limit', String(params.limit))
      }
      if (params.offset !== undefined && params.offset !== null) {
        searchParams.append('sysparm_offset', String(params.offset))
      }

      return withQueryString(`${baseUrl}/api/sn_chg_rest/change/${changeSysId}/task`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const tasks = toRecordArray(data.result)

    return {
      success: true,
      output: {
        tasks,
        metadata: { recordCount: tasks.length },
      },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description:
        'Change tasks, under `tasks` rather than the `records` key the Table API list operations use. Each field is an object of the form {value, display_value} — the Change Management API fixes this shape, so unlike those operations there is no display-value setting. `parent` holds the owning change request.',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of change tasks returned' },
      },
    },
  },
}
