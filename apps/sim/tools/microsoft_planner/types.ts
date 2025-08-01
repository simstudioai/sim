import type { ToolResponse } from '@/tools/types'

export interface PlannerTask {
  id?: string
  planId: string
  title: string
  orderHint?: string
  assigneePriority?: string
  percentComplete?: number
  startDateTime?: string
  createdDateTime?: string
  dueDateTime?: string
  hasDescription?: boolean
  previewType?: string
  completedDateTime?: string
  completedBy?: any
  referenceCount?: number
  checklistItemCount?: number
  activeChecklistItemCount?: number
  conversationThreadId?: string
  priority?: number
  assignments?: Record<string, any>
  bucketId?: string
  details?: {
    description?: string
    references?: Record<string, any>
    checklist?: Record<string, any>
  }
}

export interface PlannerPlan {
  id: string
  title: string
  owner?: string
  createdDateTime?: string
  container?: any
}

export interface MicrosoftPlannerMetadata {
  planId?: string
  taskId?: string
  userId?: string
  planUrl?: string
  taskUrl?: string
}

export interface MicrosoftPlannerReadResponse extends ToolResponse {
  output: {
    tasks?: PlannerTask[]
    task?: PlannerTask
    plan?: PlannerPlan
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerCreateResponse extends ToolResponse {
  output: {
    task: PlannerTask
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerToolParams {
  accessToken: string
  planId?: string
  taskId?: string
  title?: string
  description?: string
  dueDateTime?: string
  assigneeUserId?: string
  bucketId?: string
  priority?: number
  percentComplete?: number
}

export type MicrosoftPlannerResponse = MicrosoftPlannerReadResponse | MicrosoftPlannerCreateResponse

