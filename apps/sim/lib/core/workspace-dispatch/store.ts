import type { WorkspaceDispatchStorageAdapter } from '@/lib/core/workspace-dispatch/adapter'
import {
  setWorkspaceDispatchStorageAdapter as _setAdapter,
  createWorkspaceDispatchStorageAdapter,
} from '@/lib/core/workspace-dispatch/factory'
import type {
  WorkspaceDispatchClaimResult,
  WorkspaceDispatchEnqueueInput,
  WorkspaceDispatchJobRecord,
  WorkspaceDispatchLane,
} from '@/lib/core/workspace-dispatch/types'

function getAdapter() {
  return createWorkspaceDispatchStorageAdapter()
}

export function setWorkspaceDispatchStorageAdapter(adapter: WorkspaceDispatchStorageAdapter): void {
  _setAdapter(adapter)
}

export async function saveDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void> {
  return getAdapter().saveDispatchJob(record)
}

export async function getDispatchJobRecord(
  jobId: string
): Promise<WorkspaceDispatchJobRecord | null> {
  return getAdapter().getDispatchJobRecord(jobId)
}

export async function listDispatchJobsByStatuses(
  statuses: readonly WorkspaceDispatchJobRecord['status'][]
): Promise<WorkspaceDispatchJobRecord[]> {
  return getAdapter().listDispatchJobsByStatuses(statuses)
}

export async function updateDispatchJobRecord(
  jobId: string,
  updater: (record: WorkspaceDispatchJobRecord) => WorkspaceDispatchJobRecord
): Promise<WorkspaceDispatchJobRecord | null> {
  return getAdapter().updateDispatchJobRecord(jobId, updater)
}

export async function enqueueWorkspaceDispatchJob(
  input: WorkspaceDispatchEnqueueInput
): Promise<WorkspaceDispatchJobRecord> {
  return getAdapter().enqueueWorkspaceDispatchJob(input)
}

export async function restoreWorkspaceDispatchJob(
  record: WorkspaceDispatchJobRecord
): Promise<void> {
  return getAdapter().restoreWorkspaceDispatchJob(record)
}

export async function claimWorkspaceJob(
  workspaceId: string,
  options: {
    lanes: readonly WorkspaceDispatchLane[]
    concurrencyLimit: number
    leaseId: string
    now: number
    leaseTtlMs: number
  }
): Promise<WorkspaceDispatchClaimResult> {
  return getAdapter().claimWorkspaceJob(workspaceId, options)
}

export async function getWorkspaceQueueDepth(
  workspaceId: string,
  lanes: readonly WorkspaceDispatchLane[]
): Promise<number> {
  return getAdapter().getWorkspaceQueueDepth(workspaceId, lanes)
}

export async function getGlobalQueueDepth(): Promise<number> {
  return getAdapter().getGlobalQueueDepth()
}

export async function reconcileGlobalQueueDepth(knownCount: number): Promise<void> {
  return getAdapter().reconcileGlobalQueueDepth(knownCount)
}

export async function popNextWorkspaceId(): Promise<string | null> {
  return getAdapter().popNextWorkspaceId()
}

export async function getQueuedWorkspaceCount(): Promise<number> {
  return getAdapter().getQueuedWorkspaceCount()
}

export async function hasActiveWorkspace(workspaceId: string): Promise<boolean> {
  return getAdapter().hasActiveWorkspace(workspaceId)
}

export async function ensureWorkspaceActive(workspaceId: string, readyAt?: number): Promise<void> {
  return getAdapter().ensureWorkspaceActive(workspaceId, readyAt)
}

export async function requeueWorkspaceId(workspaceId: string): Promise<void> {
  return getAdapter().requeueWorkspaceId(workspaceId)
}

export async function workspaceHasPendingJobs(
  workspaceId: string,
  lanes: readonly WorkspaceDispatchLane[]
): Promise<boolean> {
  return getAdapter().workspaceHasPendingJobs(workspaceId, lanes)
}

export async function getNextWorkspaceJob(
  workspaceId: string,
  lanes: readonly WorkspaceDispatchLane[]
): Promise<WorkspaceDispatchJobRecord | null> {
  return getAdapter().getNextWorkspaceJob(workspaceId, lanes)
}

export async function removeWorkspaceJobFromLane(
  workspaceId: string,
  lane: WorkspaceDispatchLane,
  jobId: string
): Promise<void> {
  return getAdapter().removeWorkspaceJobFromLane(workspaceId, lane, jobId)
}

export async function cleanupExpiredWorkspaceLeases(workspaceId: string): Promise<void> {
  return getAdapter().cleanupExpiredWorkspaceLeases(workspaceId)
}

export async function countActiveWorkspaceLeases(workspaceId: string): Promise<number> {
  return getAdapter().countActiveWorkspaceLeases(workspaceId)
}

export async function hasWorkspaceLease(workspaceId: string, leaseId: string): Promise<boolean> {
  return getAdapter().hasWorkspaceLease(workspaceId, leaseId)
}

export async function createWorkspaceLease(
  workspaceId: string,
  leaseId: string,
  ttlMs: number
): Promise<number> {
  return getAdapter().createWorkspaceLease(workspaceId, leaseId, ttlMs)
}

export async function refreshWorkspaceLease(
  workspaceId: string,
  leaseId: string,
  ttlMs: number
): Promise<number> {
  return getAdapter().refreshWorkspaceLease(workspaceId, leaseId, ttlMs)
}

export async function releaseWorkspaceLease(workspaceId: string, leaseId: string): Promise<void> {
  return getAdapter().releaseWorkspaceLease(workspaceId, leaseId)
}

export async function removeWorkspaceIfIdle(
  workspaceId: string,
  lanes: readonly WorkspaceDispatchLane[]
): Promise<void> {
  return getAdapter().removeWorkspaceIfIdle(workspaceId, lanes)
}

export async function markDispatchJobAdmitted(
  jobId: string,
  workspaceId: string,
  leaseId: string,
  leaseExpiresAt: number
): Promise<void> {
  return getAdapter().markDispatchJobAdmitted(jobId, workspaceId, leaseId, leaseExpiresAt)
}

export async function markDispatchJobAdmitting(
  jobId: string,
  workspaceId: string,
  leaseId: string,
  leaseExpiresAt: number
): Promise<void> {
  return getAdapter().markDispatchJobAdmitting(jobId, workspaceId, leaseId, leaseExpiresAt)
}

export async function markDispatchJobRunning(jobId: string): Promise<void> {
  return getAdapter().markDispatchJobRunning(jobId)
}

export async function markDispatchJobCompleted(jobId: string, output: unknown): Promise<void> {
  return getAdapter().markDispatchJobCompleted(jobId, output)
}

export async function markDispatchJobFailed(jobId: string, error: string): Promise<void> {
  return getAdapter().markDispatchJobFailed(jobId, error)
}
