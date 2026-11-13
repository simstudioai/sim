import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_PAGINATION_OUTPUT,
  MONACO_TASK_OUTPUT_PROPERTIES,
  type MonacoListTasksParams,
  type MonacoListTasksResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoPagination,
  mapMonacoTask,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListTasksTool: ToolConfig<MonacoListTasksParams, MonacoListTasksResponse> = {
  id: 'monaco_list_tasks',
  name: 'Monaco List Tasks',
  description:
    'List Monaco tasks with optional filters, sorting, and pagination. Email drafts are omitted from list results; use Get Task for them.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/tasks/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoListBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        tasks: toArray(data.data).map(mapMonacoTask),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description: 'Tasks on this page',
      items: { type: 'object', properties: MONACO_TASK_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
