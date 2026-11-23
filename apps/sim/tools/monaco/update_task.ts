import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_TASK_OUTPUT_PROPERTIES,
  type MonacoTaskResponse,
  type MonacoUpdateTaskParams,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoTask,
  monacoHeaders,
  parseMonacoObject,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoUpdateTaskTool: ToolConfig<MonacoUpdateTaskParams, MonacoTaskResponse> = {
  id: 'monaco_update_task',
  name: 'Monaco Update Task',
  description:
    'Update a Monaco task. Only the fields you set are changed; setting status to DONE or CANCELLED marks it completed.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (UUID) of the task to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title of the task (max 256 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed description of the task (max 65,536 characters)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Status of the task. One of TODO, DONE, CANCELLED. Moving to DONE or CANCELLED sets completed_at; moving out of those states clears it.',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID (UUID) of the account to associate the task with. Only supported for manually created tasks.',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID (UUID) to assign the task to. Use List Users to find IDs.',
    },
    dueAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date and time for the task (ISO 8601 date-time)',
    },
    messageDraft: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Draft email as {"recipients": [{"name", "email"}], "cc": [{"name", "email"}], "subject", "body"}; replaces the existing draft. recipients, subject, and body are required. Only valid for EMAIL tasks.',
    },
  },

  request: {
    url: (params) => `${MONACO_API_BASE}/v1/tasks/${safeUrlPathSegment(params.taskId, 'taskId')}`,
    method: 'PATCH',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const title = params.title?.trim()
      if (title) body.title = title
      const description = params.description?.trim()
      if (description) body.description = description
      const status = params.status?.trim()
      if (status) body.status = status
      const accountId = params.accountId?.trim()
      if (accountId) body.account_id = accountId
      const assigneeId = params.assigneeId?.trim()
      if (assigneeId) body.assignee_id = assigneeId
      const dueAt = params.dueAt?.trim()
      if (dueAt) body.due_at = dueAt
      const messageDraft = parseMonacoObject(params.messageDraft, 'messageDraft')
      if (messageDraft !== undefined) body.message_draft = messageDraft
      if (Object.keys(body).length === 0) throw new Error('Provide at least one field to update')
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { task: mapMonacoTask(data.data) } }
  },

  outputs: {
    task: {
      type: 'object',
      description: 'The updated task',
      properties: MONACO_TASK_OUTPUT_PROPERTIES,
    },
  },
}
