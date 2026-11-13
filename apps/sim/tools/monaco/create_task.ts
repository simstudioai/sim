import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_TASK_OUTPUT_PROPERTIES,
  type MonacoCreateTaskParams,
  type MonacoTaskResponse,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoTask,
  monacoHeaders,
  parseMonacoObject,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoCreateTaskTool: ToolConfig<MonacoCreateTaskParams, MonacoTaskResponse> = {
  id: 'monaco_create_task',
  name: 'Monaco Create Task',
  description:
    'Create a Monaco task, optionally linked to an account and/or opportunity. Without an assignee, the task is assigned to the API key owner.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the task (max 256 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed description of the task (max 65,536 characters)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID (UUID) of the account to associate the task with',
    },
    opportunityId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID (UUID) of the opportunity to associate the task with',
    },
    taskType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of task. One of GENERAL_ACTION_ITEM, EMAIL. Defaults to GENERAL_ACTION_ITEM.',
    },
    assigneeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID (UUID) to assign the task to. Defaults to the API key owner. Use List Users to find IDs.',
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
        'Draft email as {"recipients": [{"name", "email"}], "cc": [{"name", "email"}], "subject", "body"}. recipients, subject, and body are required; body may be plain text or HTML. Only valid when taskType is EMAIL.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/tasks/`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = { title: params.title.trim() }
      const description = params.description?.trim()
      if (description) body.description = description
      const accountId = params.accountId?.trim()
      if (accountId) body.account_id = accountId
      const opportunityId = params.opportunityId?.trim()
      if (opportunityId) body.opportunity_id = opportunityId
      const taskType = params.taskType?.trim()
      if (taskType) body.task_type = taskType
      const assigneeId = params.assigneeId?.trim()
      if (assigneeId) body.assignee_id = assigneeId
      const dueAt = params.dueAt?.trim()
      if (dueAt) body.due_at = dueAt
      const messageDraft = parseMonacoObject(params.messageDraft, 'messageDraft')
      if (messageDraft !== undefined) body.message_draft = messageDraft
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
      description: 'The created task',
      properties: MONACO_TASK_OUTPUT_PROPERTIES,
    },
  },
}
