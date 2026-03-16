import type {
  WorkspaceDispatchClaimResult,
  WorkspaceDispatchEnqueueInput,
  WorkspaceDispatchJobRecord,
  WorkspaceDispatchLane,
} from '@/lib/core/workspace-dispatch/types'

export interface WorkspaceDispatchStorageAdapter {
  saveDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void>
  getDispatchJobRecord(jobId: string): Promise<WorkspaceDispatchJobRecord | null>
  listDispatchJobsByStatuses(
    statuses: readonly WorkspaceDispatchJobRecord['status'][]
  ): Promise<WorkspaceDispatchJobRecord[]>
  updateDispatchJobRecord(
    jobId: string,
    updater: (record: WorkspaceDispatchJobRecord) => WorkspaceDispatchJobRecord
  ): Promise<WorkspaceDispatchJobRecord | null>
  enqueueWorkspaceDispatchJob(
    input: WorkspaceDispatchEnqueueInput
  ): Promise<WorkspaceDispatchJobRecord>
  restoreWorkspaceDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void>
  claimWorkspaceJob(
    workspaceId: string,
    options: {
      lanes: readonly WorkspaceDispatchLane[]
      concurrencyLimit: number
      leaseId: string
      now: number
      leaseTtlMs: number
    }
  ): Promise<WorkspaceDispatchClaimResult>
  getWorkspaceQueueDepth(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<number>
  getGlobalQueueDepth(): Promise<number>
  reconcileGlobalQueueDepth(knownCount: number): Promise<void>
  popNextWorkspaceId(): Promise<string | null>
  getQueuedWorkspaceCount(): Promise<number>
  hasActiveWorkspace(workspaceId: string): Promise<boolean>
  ensureWorkspaceActive(workspaceId: string, readyAt?: number): Promise<void>
  requeueWorkspaceId(workspaceId: string): Promise<void>
  workspaceHasPendingJobs(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<boolean>
  getNextWorkspaceJob(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<WorkspaceDispatchJobRecord | null>
  removeWorkspaceJobFromLane(
    workspaceId: string,
    lane: WorkspaceDispatchLane,
    jobId: string
  ): Promise<void>
  cleanupExpiredWorkspaceLeases(workspaceId: string): Promise<void>
  countActiveWorkspaceLeases(workspaceId: string): Promise<number>
  hasWorkspaceLease(workspaceId: string, leaseId: string): Promise<boolean>
  createWorkspaceLease(workspaceId: string, leaseId: string, ttlMs: number): Promise<number>
  refreshWorkspaceLease(workspaceId: string, leaseId: string, ttlMs: number): Promise<number>
  releaseWorkspaceLease(workspaceId: string, leaseId: string): Promise<void>
  removeWorkspaceIfIdle(workspaceId: string, lanes: readonly WorkspaceDispatchLane[]): Promise<void>
  markDispatchJobAdmitted(
    jobId: string,
    workspaceId: string,
    leaseId: string,
    leaseExpiresAt: number
  ): Promise<void>
  markDispatchJobAdmitting(
    jobId: string,
    workspaceId: string,
    leaseId: string,
    leaseExpiresAt: number
  ): Promise<void>
  markDispatchJobRunning(jobId: string): Promise<void>
  markDispatchJobCompleted(jobId: string, output: unknown): Promise<void>
  markDispatchJobFailed(jobId: string, error: string): Promise<void>
  clear(): Promise<void>
  dispose(): void
}
