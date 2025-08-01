import type { ToolResponse } from '@/tools/types'

export interface PlannerIdentitySet {
  user?: {
    displayName?: string
    id?: string
  }
  application?: {
    displayName?: string
    id?: string
  }
}

export interface PlannerAssignment {
  '@odata.type': string
  assignedDateTime?: string
  orderHint?: string
  assignedBy?: PlannerIdentitySet
}

export interface PlannerReference {
  alias?: string
  lastModifiedBy?: PlannerIdentitySet
  lastModifiedDateTime?: string
  previewPriority?: string
  type?: string
}

export interface PlannerChecklistItem {
  '@odata.type': string
  isChecked?: boolean
  title?: string
  orderHint?: string
  lastModifiedBy?: PlannerIdentitySet
  lastModifiedDateTime?: string
}

export interface PlannerContainer {
  containerId?: string
  type?: string
  url?: string
}

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
  completedBy?: PlannerIdentitySet
  referenceCount?: number
  checklistItemCount?: number
  activeChecklistItemCount?: number
  conversationThreadId?: string
  priority?: number
  assignments?: Record<string, PlannerAssignment>
  bucketId?: string
  details?: {
    description?: string
    references?: Record<string, PlannerReference>
    checklist?: Record<string, PlannerChecklistItem>
  }
}

export interface PlannerPlan {
  id: string
  title: string
  owner?: string
  createdDateTime?: string
  container?: PlannerContainer
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
