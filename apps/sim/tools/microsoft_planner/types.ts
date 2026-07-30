import type { ToolResponse } from '@/tools/types'

interface PlannerIdentitySet {
  user?: {
    displayName?: string
    id?: string
  }
  application?: {
    displayName?: string
    id?: string
  }
}

interface PlannerAssignment {
  '@odata.type': string
  assignedDateTime?: string
  orderHint?: string
  assignedBy?: PlannerIdentitySet
}

interface PlannerReference {
  alias?: string
  lastModifiedBy?: PlannerIdentitySet
  lastModifiedDateTime?: string
  previewPriority?: string
  type?: string
}

interface PlannerChecklistItem {
  '@odata.type': string
  isChecked?: boolean
  title?: string
  orderHint?: string
  lastModifiedBy?: PlannerIdentitySet
  lastModifiedDateTime?: string
}

interface PlannerContainer {
  containerId?: string
  type?: string
  url?: string
}

interface PlannerAppliedCategories {
  [category: string]: boolean
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
  appliedCategories?: PlannerAppliedCategories
  bucketId?: string
  details?: {
    description?: string
    references?: Record<string, PlannerReference>
    checklist?: Record<string, PlannerChecklistItem>
  }
}

export interface PlannerBucket {
  id: string
  name: string
  planId: string
  orderHint?: string
  '@odata.etag'?: string
}

export interface PlannerPlan {
  id: string
  title: string
  owner?: string
  createdDateTime?: string
  container?: PlannerContainer
  '@odata.etag'?: string
}

export interface PlannerPlanDetails {
  id: string
  categoryDescriptions?: Record<string, string | null>
  sharedWith?: Record<string, boolean>
  '@odata.etag'?: string
}

export interface PlannerTaskDetails {
  id: string
  description?: string
  previewType?: string
  references?: Record<string, PlannerReference>
  checklist?: Record<string, PlannerChecklistItem>
  '@odata.etag'?: string
}

interface MicrosoftPlannerMetadata {
  planId?: string
  taskId?: string
  userId?: string | null
  planUrl?: string | null
  taskUrl?: string
  bucketId?: string
  groupId?: string
  count?: number
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

export interface MicrosoftPlannerUpdateTaskResponse extends ToolResponse {
  output: {
    message: string
    task: PlannerTask
    taskId: string
    etag: string
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerDeleteTaskResponse extends ToolResponse {
  output: {
    deleted: boolean
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerListPlansResponse extends ToolResponse {
  output: {
    plans: PlannerPlan[]
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerReadPlanResponse extends ToolResponse {
  output: {
    plan: PlannerPlan
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerCreatePlanResponse extends ToolResponse {
  output: {
    plan: PlannerPlan
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerDeletePlanResponse extends ToolResponse {
  output: {
    deleted: boolean
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerGetPlanDetailsResponse extends ToolResponse {
  output: {
    planDetails: PlannerPlanDetails
    etag: string
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerListBucketsResponse extends ToolResponse {
  output: {
    buckets: PlannerBucket[]
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerReadBucketResponse extends ToolResponse {
  output: {
    bucket: PlannerBucket
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerCreateBucketResponse extends ToolResponse {
  output: {
    bucket: PlannerBucket
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerUpdateBucketResponse extends ToolResponse {
  output: {
    bucket: PlannerBucket
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerDeleteBucketResponse extends ToolResponse {
  output: {
    deleted: boolean
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerGetTaskDetailsResponse extends ToolResponse {
  output: {
    taskDetails: PlannerTaskDetails
    etag: string
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerUpdateTaskDetailsResponse extends ToolResponse {
  output: {
    taskDetails: PlannerTaskDetails
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerUpdatePlanResponse extends ToolResponse {
  output: {
    plan: PlannerPlan
    metadata: MicrosoftPlannerMetadata
  }
}

export interface MicrosoftPlannerUpdatePlanDetailsResponse extends ToolResponse {
  output: {
    planDetails: PlannerPlanDetails
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
  startDateTime?: string
  assigneeUserId?: string
  bucketId?: string
  priority?: number
  percentComplete?: number
  groupId?: string
  name?: string
  etag?: string
  checklist?: Record<string, any>
  references?: Record<string, any>
  previewType?: string
  appliedCategories?: string
  categoryDescriptions?: Record<string, any>
  sharedWith?: Record<string, any>
}

export type MicrosoftPlannerResponse =
  | MicrosoftPlannerReadResponse
  | MicrosoftPlannerCreateResponse
  | MicrosoftPlannerUpdateTaskResponse
  | MicrosoftPlannerDeleteTaskResponse
  | MicrosoftPlannerListPlansResponse
  | MicrosoftPlannerReadPlanResponse
  | MicrosoftPlannerCreatePlanResponse
  | MicrosoftPlannerDeletePlanResponse
  | MicrosoftPlannerGetPlanDetailsResponse
  | MicrosoftPlannerListBucketsResponse
  | MicrosoftPlannerReadBucketResponse
  | MicrosoftPlannerCreateBucketResponse
  | MicrosoftPlannerUpdateBucketResponse
  | MicrosoftPlannerDeleteBucketResponse
  | MicrosoftPlannerGetTaskDetailsResponse
  | MicrosoftPlannerUpdateTaskDetailsResponse
  | MicrosoftPlannerUpdatePlanResponse
  | MicrosoftPlannerUpdatePlanDetailsResponse
