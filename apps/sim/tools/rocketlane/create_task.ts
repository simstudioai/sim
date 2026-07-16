import {
  buildTaskMembers,
  mapTask,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateTaskParams,
  type RocketlaneTaskResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateTaskTool: ToolConfig<
  RocketlaneCreateTaskParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_create_task',
  name: 'Rocketlane Create Task',
  description: 'Create a new task in a Rocketlane project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    taskName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the task',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the project the task belongs to',
    },
    taskDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the task in HTML format',
    },
    taskPrivateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private note visible only to team members, in HTML format',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date when the task starts (YYYY-MM-DD)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date when the task is due, on or after the start date (YYYY-MM-DD)',
    },
    effortInMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected effort to complete the task, in minutes',
    },
    progress: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Progress of the task (0-100)',
    },
    atRisk: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the task is marked as At Risk',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of the task: TASK or MILESTONE (defaults to TASK)',
    },
    phaseId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the phase to associate the task with (must belong to the project)',
    },
    statusValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status value to set on the task',
    },
    assigneeUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of members to assign to the task',
      items: { type: 'number' },
    },
    assigneeEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email addresses of members to assign to the task',
      items: { type: 'string' },
    },
    followerUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of members to add as followers of the task',
      items: { type: 'number' },
    },
    followerEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email addresses of members to add as followers of the task',
      items: { type: 'string' },
    },
    parentTaskId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the parent task',
    },
    externalReferenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External reference identifier linking the task to an external system',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the task is private',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra fields to include in the response (startDateActual, dueDateActual, type, phase, assignees, followers, dependencies, billable, csatEnabled, priority, timeEntryCategory, financialsBudget, taskPrivateNote, parent, externalReferenceId)',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether all fields should be returned in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/tasks`)
      if (params.includeFields && params.includeFields.length > 0) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields !== undefined) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        taskName: params.taskName,
        project: { projectId: params.projectId },
      }
      if (params.taskDescription !== undefined) body.taskDescription = params.taskDescription
      if (params.taskPrivateNote !== undefined) body.taskPrivateNote = params.taskPrivateNote
      if (params.startDate !== undefined) body.startDate = params.startDate
      if (params.dueDate !== undefined) body.dueDate = params.dueDate
      if (params.effortInMinutes !== undefined) body.effortInMinutes = params.effortInMinutes
      if (params.progress !== undefined) body.progress = params.progress
      if (params.atRisk !== undefined) body.atRisk = params.atRisk
      if (params.type !== undefined) body.type = params.type
      if (params.phaseId !== undefined) body.phase = { phaseId: params.phaseId }
      if (params.statusValue !== undefined) body.status = { value: params.statusValue }
      const assignees = buildTaskMembers(params.assigneeUserIds, params.assigneeEmailIds)
      if (assignees.length > 0) body.assignees = { members: assignees }
      const followers = buildTaskMembers(params.followerUserIds, params.followerEmailIds)
      if (followers.length > 0) body.followers = { members: followers }
      if (params.parentTaskId !== undefined) body.parent = { taskId: params.parentTaskId }
      if (params.externalReferenceId !== undefined) {
        body.externalReferenceId = params.externalReferenceId
      }
      if (params.private !== undefined) body.private = params.private
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { task: mapTask(data) },
    }
  },

  outputs: {
    task: {
      type: 'object',
      description: 'The created task',
      properties: TASK_OUTPUT_PROPERTIES,
    },
  },
}
