import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_TASK_OUTPUT_PROPERTIES,
  type MonacoGetTaskParams,
  type MonacoTaskResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoTask, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetTaskTool: ToolConfig<MonacoGetTaskParams, MonacoTaskResponse> = {
  id: 'monaco_get_task',
  name: 'Monaco Get Task',
  description: 'Get one Monaco task by ID, including the email draft for EMAIL tasks.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (UUID) of the task to fetch',
    },
  },

  request: {
    url: (params) => `${MONACO_API_BASE}/v1/tasks/${safeUrlPathSegment(params.taskId, 'taskId')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { task: mapMonacoTask(data.data) } }
  },

  outputs: {
    task: { type: 'object', description: 'The task', properties: MONACO_TASK_OUTPUT_PROPERTIES },
  },
}
