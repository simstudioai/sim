import { createLogger } from '@sim/logger'
import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftPlannerReadResponse,
  MicrosoftPlannerToolParams,
  PlannerTaskSummary,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

function identityUserId(value: unknown): string | null {
  return toStringOrNull(toRecord(toRecord(value).user).id)
}

const logger = createLogger('MicrosoftPlannerReadTask')

export const readTaskTool: ToolConfig<MicrosoftPlannerToolParams, MicrosoftPlannerReadResponse> = {
  id: 'microsoft_planner_read_task',
  name: 'Read Microsoft Planner Tasks',
  description:
    'Read tasks from Microsoft Planner - get all user tasks or all tasks from a specific plan',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-planner',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Planner API',
    },
    planId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the plan to get tasks from, if not provided gets all user tasks (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the task to get (e.g., "pbT5K2OVkkO1M7r5bfsJ6JgAGD5m")',
    },
  },

  request: {
    url: (params) => {
      if (params.taskId) {
        return `https://graph.microsoft.com/v1.0/planner/tasks/${safeUrlPathSegment(params.taskId, 'taskId')}`
      }
      if (params.planId) {
        return `https://graph.microsoft.com/v1.0/planner/plans/${safeUrlPathSegment(params.planId, 'planId')}/tasks`
      }
      return 'https://graph.microsoft.com/v1.0/me/planner/tasks'
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const rawTasks: unknown[] = data.value ? data.value : Array.isArray(data) ? data : [data]

    const tasks: PlannerTaskSummary[] = rawTasks.map((value) => {
      const task = toRecord(value)
      let etagValue = toStringOrNull(task['@odata.etag'])
      if (etagValue?.includes('\\"')) {
        etagValue = etagValue.replace(/\\"/g, '"')
      }

      const assignments = toRecord(task.assignments)

      return {
        id: toStringOrNull(task.id) ?? undefined,
        title: toStringOrNull(task.title) ?? undefined,
        planId: toStringOrNull(task.planId) ?? undefined,
        bucketId: toStringOrNull(task.bucketId),
        percentComplete: toNumberOrNull(task.percentComplete) ?? undefined,
        priority: toNumberOrNull(task.priority) ?? undefined,
        dueDateTime: toStringOrNull(task.dueDateTime),
        createdDateTime: toStringOrNull(task.createdDateTime) ?? undefined,
        completedDateTime: toStringOrNull(task.completedDateTime),
        hasDescription: toBooleanOrNull(task.hasDescription) ?? undefined,
        assignments: Object.keys(assignments),
        etag: etagValue,
        startDateTime: toStringOrNull(task.startDateTime),
        orderHint: toStringOrNull(task.orderHint),
        assigneePriority: toStringOrNull(task.assigneePriority),
        appliedCategories: Object.entries(toRecord(task.appliedCategories))
          .filter(([, applied]) => applied === true)
          .map(([category]) => category),
        previewType: toStringOrNull(task.previewType),
        checklistItemCount: toNumberOrNull(task.checklistItemCount),
        activeChecklistItemCount: toNumberOrNull(task.activeChecklistItemCount),
        referenceCount: toNumberOrNull(task.referenceCount),
        conversationThreadId: toStringOrNull(task.conversationThreadId),
        createdBy: identityUserId(task.createdBy),
        completedBy: identityUserId(task.completedBy),
        assignees: Object.entries(assignments).map(([userId, assignment]) => {
          const details = toRecord(assignment)
          return {
            userId,
            assignedDateTime: toStringOrNull(details.assignedDateTime),
            assignedBy: identityUserId(details.assignedBy),
          }
        }),
      }
    })

    const result: MicrosoftPlannerReadResponse = {
      success: true,
      output: {
        tasks,
        metadata: {
          planId: tasks.length > 0 ? tasks[0].planId : null,
          userId: data.value ? null : 'me',
          planUrl:
            tasks.length > 0
              ? `https://graph.microsoft.com/v1.0/planner/plans/${tasks[0].planId}`
              : null,
        },
      },
    }

    logger.info('Transformed Planner tasks', { count: tasks.length })
    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether tasks were retrieved successfully' },
    tasks: {
      type: 'array',
      description: 'Array of task objects with filtered properties',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
          title: { type: 'string', description: 'Task title' },
          planId: { type: 'string', description: 'Parent plan ID' },
          bucketId: { type: 'string', description: 'Bucket ID', nullable: true },
          percentComplete: {
            type: 'number',
            description: 'Completion percentage; 100 means completed',
          },
          priority: {
            type: 'number',
            description:
              'Priority from 0 (highest) to 10 (lowest); Planner uses 1 urgent, 3 important, 5 medium, 9 low',
          },
          dueDateTime: { type: 'string', description: 'Due date (ISO 8601)', nullable: true },
          createdDateTime: { type: 'string', description: 'Creation time (ISO 8601)' },
          completedDateTime: {
            type: 'string',
            description: 'Completion time (ISO 8601)',
            nullable: true,
          },
          hasDescription: {
            type: 'boolean',
            description: 'Whether the task details have a description',
          },
          assignments: {
            type: 'array',
            description: 'User IDs the task is assigned to',
            items: { type: 'string' },
          },
          etag: {
            type: 'string',
            description: 'Task ETag for Update Task and Delete Task (not for Update Task Details)',
            nullable: true,
          },
          startDateTime: {
            type: 'string',
            description: 'Start date (ISO 8601)',
            optional: true,
            nullable: true,
          },
          orderHint: { type: 'string', description: 'Order hint', optional: true, nullable: true },
          assigneePriority: {
            type: 'string',
            description: 'Order hint for the assignee view',
            optional: true,
            nullable: true,
          },
          appliedCategories: {
            type: 'array',
            description: 'Applied category labels, such as category1',
            optional: true,
            items: { type: 'string' },
          },
          previewType: {
            type: 'string',
            description: 'Preview type shown on the task card',
            optional: true,
            nullable: true,
          },
          checklistItemCount: {
            type: 'number',
            description: 'Number of checklist items',
            optional: true,
            nullable: true,
          },
          activeChecklistItemCount: {
            type: 'number',
            description: 'Number of unchecked checklist items',
            optional: true,
            nullable: true,
          },
          referenceCount: {
            type: 'number',
            description: 'Number of external references',
            optional: true,
            nullable: true,
          },
          conversationThreadId: {
            type: 'string',
            description: 'Group conversation thread ID for the task',
            optional: true,
            nullable: true,
          },
          createdBy: {
            type: 'string',
            description: 'User ID of the task creator',
            optional: true,
            nullable: true,
          },
          completedBy: {
            type: 'string',
            description: 'User ID of the user who completed the task',
            optional: true,
            nullable: true,
          },
          assignees: {
            type: 'array',
            description: 'Assignment details per assignee',
            optional: true,
            items: {
              type: 'object',
              properties: {
                userId: { type: 'string', description: 'Assignee user ID' },
                assignedDateTime: {
                  type: 'string',
                  description: 'When the user was assigned',
                  nullable: true,
                },
                assignedBy: {
                  type: 'string',
                  description: 'User ID of who made the assignment',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Metadata including planId, userId, and planUrl',
      properties: {
        planId: { type: 'string', description: 'Plan ID', optional: true },
        userId: { type: 'string', description: 'User ID', optional: true },
        planUrl: {
          type: 'string',
          description: 'Microsoft Graph API URL for the plan',
          optional: true,
        },
      },
    },
  },
}
