import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  TaskStatus,
  TaskStatusRequest,
  TaskWakeAccepted,
  TaskWakeRequest,
  WorkflowWatchRequest,
  WorkflowWatchStatus,
} from '@/lib/mothership/generated/tasks'

export const workflowWatchStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/tasks/workflow-status',
  body: WorkflowWatchRequest,
  response: { mode: 'json', schema: WorkflowWatchStatus },
})

export const wakeMothershipTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/wake',
  body: TaskWakeRequest,
  response: { mode: 'json', schema: TaskWakeAccepted, status: 202 },
})

export const getMothershipTaskStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/tasks/[taskId]',
  params: TaskStatusRequest,
  response: { mode: 'json', schema: TaskStatus },
})
