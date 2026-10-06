import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import type {
  YouComGetResearchTaskParams,
  YouComGetResearchTaskResponse,
} from '@/tools/youcom/types'
import {
  mapResearchSources,
  RESEARCH_ANSWER_OUTPUTS,
  YOUCOM_API_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComGetResearchTaskTool: ToolConfig<
  YouComGetResearchTaskParams,
  YouComGetResearchTaskResponse
> = {
  id: 'youcom_get_research_task',
  name: 'You.com Get Research Task',
  description:
    'Get the status of a background research task and, once completed, its cited answer and sources.',
  version: '1.0.0',

  params: {
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the background research task',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    url: (params) =>
      `${YOUCOM_API_BASE_URL}/research/${safeUrlPathSegment(params.taskId, 'taskId')}`,
    method: 'GET',
    headers: youComHeaders,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const input = toRecordOrNull(data.input)
    const result = toRecordOrNull(data.result)
    const output = toRecordOrNull(result?.output)

    return {
      success: true,
      output: {
        taskId: String(data.id ?? ''),
        taskType: String(data.task_type ?? ''),
        status: String(data.status ?? ''),
        createdAt: String(data.created_at ?? ''),
        updatedAt: toStringOrNull(data.updated_at),
        completedAt: toStringOrNull(data.completed_at),
        error: toStringOrNull(data.error),
        taskInput: input
          ? {
              input: String(input.input ?? ''),
              researchEffort: String(input.research_effort ?? ''),
              background: input.background === true,
              outputSchema: toRecordOrNull(input.output_schema),
              sourceControl: toRecordOrNull(input.source_control),
              type: String(input.type ?? ''),
            }
          : null,
        content: (output?.content as string | Record<string, unknown> | undefined) ?? null,
        contentType: toStringOrNull(output?.content_type),
        sources: mapResearchSources(output?.sources),
        warnings: toArray(result?.warnings).map(String),
      },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'ID of the background research task' },
    taskType: { type: 'string', description: 'Task type (research)' },
    status: {
      type: 'string',
      description: 'Task status: queued, running, completed, failed, or cancelled',
    },
    createdAt: { type: 'string', description: 'When the task was created, RFC 3339' },
    updatedAt: {
      type: 'string',
      description: 'When the task was last updated, RFC 3339',
      nullable: true,
    },
    completedAt: {
      type: 'string',
      description: 'When the task reached a terminal status, RFC 3339',
      nullable: true,
    },
    error: { type: 'string', description: 'Diagnostic message when failed', nullable: true },
    taskInput: {
      type: 'json',
      description: 'Original request parameters submitted for the task',
      nullable: true,
      properties: {
        input: { type: 'string', description: 'Research question that was submitted' },
        researchEffort: { type: 'string', description: 'Research effort level submitted' },
        background: { type: 'boolean', description: 'Whether background mode was requested' },
        outputSchema: {
          type: 'json',
          description: 'Structured output schema submitted',
          nullable: true,
        },
        sourceControl: {
          type: 'json',
          description: 'Source control configuration submitted',
          nullable: true,
        },
        type: { type: 'string', description: 'Task type (research)' },
      },
    },
    ...RESEARCH_ANSWER_OUTPUTS,
  },
}
