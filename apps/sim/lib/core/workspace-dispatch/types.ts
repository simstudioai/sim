import type { JobMetadata, JobType } from '@/lib/core/async-jobs/types'
import type {
  KNOWLEDGE_CONNECTOR_SYNC_QUEUE,
  KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE,
  MOTHERSHIP_JOB_EXECUTION_QUEUE,
  WORKSPACE_NOTIFICATION_DELIVERY_QUEUE,
} from '@/lib/core/bullmq/queues'

export const WORKSPACE_DISPATCH_LANES = [
  'interactive',
  'runtime',
  'knowledge',
  'lightweight',
] as const

export type WorkspaceDispatchLane = (typeof WORKSPACE_DISPATCH_LANES)[number]

export type WorkspaceDispatchQueueName =
  | JobType
  | typeof KNOWLEDGE_CONNECTOR_SYNC_QUEUE
  | typeof KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE
  | typeof MOTHERSHIP_JOB_EXECUTION_QUEUE
  | typeof WORKSPACE_NOTIFICATION_DELIVERY_QUEUE

export const WORKSPACE_DISPATCH_STATUSES = {
  WAITING: 'waiting',
  ADMITTING: 'admitting',
  ADMITTED: 'admitted',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type WorkspaceDispatchStatus =
  (typeof WORKSPACE_DISPATCH_STATUSES)[keyof typeof WORKSPACE_DISPATCH_STATUSES]

export interface WorkspaceDispatchLeaseInfo {
  workspaceId: string
  leaseId: string
}

export interface WorkspaceDispatchJobContext {
  dispatchJobId: string
  workspaceId: string
  lane: WorkspaceDispatchLane
  queueName: WorkspaceDispatchQueueName
  bullmqJobName: string
  priority: number
}

export interface WorkspaceDispatchJobRecord {
  id: string
  workspaceId: string
  lane: WorkspaceDispatchLane
  queueName: WorkspaceDispatchQueueName
  bullmqJobName: string
  bullmqPayload: unknown
  metadata: JobMetadata
  priority: number
  maxAttempts?: number
  delayMs?: number
  status: WorkspaceDispatchStatus
  createdAt: number
  admittedAt?: number
  startedAt?: number
  completedAt?: number
  output?: unknown
  error?: string
  lease?: WorkspaceDispatchLeaseInfo
}

export interface WorkspaceDispatchEnqueueInput {
  id?: string
  workspaceId: string
  lane: WorkspaceDispatchLane
  queueName: WorkspaceDispatchQueueName
  bullmqJobName: string
  bullmqPayload: unknown
  metadata: JobMetadata
  priority?: number
  maxAttempts?: number
  delayMs?: number
}

export const WORKSPACE_DISPATCH_CLAIM_RESULTS = {
  ADMITTED: 'admitted',
  LIMIT_REACHED: 'limit_reached',
  DELAYED: 'delayed',
  EMPTY: 'empty',
} as const

export type WorkspaceDispatchClaimResult =
  | {
      type: typeof WORKSPACE_DISPATCH_CLAIM_RESULTS.ADMITTED
      record: WorkspaceDispatchJobRecord
      leaseId: string
      leaseExpiresAt: number
    }
  | {
      type:
        | typeof WORKSPACE_DISPATCH_CLAIM_RESULTS.LIMIT_REACHED
        | typeof WORKSPACE_DISPATCH_CLAIM_RESULTS.EMPTY
    }
  | {
      type: typeof WORKSPACE_DISPATCH_CLAIM_RESULTS.DELAYED
      nextReadyAt: number
    }
