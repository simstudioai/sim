import { createLogger } from '@sim/logger'
import { getBullMQQueueByName } from '@/lib/core/bullmq'
import {
  ensureWorkspaceActive,
  hasActiveWorkspace,
  hasWorkspaceLease,
  listDispatchJobsByStatuses,
  markDispatchJobAdmitted,
  markDispatchJobCompleted,
  markDispatchJobFailed,
  markDispatchJobRunning,
  reconcileGlobalQueueDepth,
  refreshWorkspaceLease,
  releaseWorkspaceLease,
  removeWorkspaceJobFromLane,
  restoreWorkspaceDispatchJob,
} from '@/lib/core/workspace-dispatch/store'
import type { WorkspaceDispatchJobRecord } from '@/lib/core/workspace-dispatch/types'
import { wakeWorkspaceDispatcher } from './dispatcher'

const logger = createLogger('WorkspaceDispatchReconciler')
const LEASE_TTL_MS = 15 * 60 * 1000

function resetToWaiting(record: WorkspaceDispatchJobRecord): WorkspaceDispatchJobRecord {
  return {
    ...record,
    status: 'waiting',
    admittedAt: undefined,
    startedAt: undefined,
    completedAt: undefined,
    output: undefined,
    error: undefined,
    lease: undefined,
  }
}

async function reconcileTerminalBullMQState(record: WorkspaceDispatchJobRecord): Promise<boolean> {
  const queue = getBullMQQueueByName(record.queueName)
  const job = await queue.getJob(record.id)
  if (!job) {
    return false
  }

  const state = await job.getState()
  if (state === 'completed') {
    await markDispatchJobCompleted(record.id, job.returnvalue)
    if (record.lease) {
      await releaseWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
    }
    return true
  }

  if (state === 'failed' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await markDispatchJobFailed(record.id, job.failedReason || 'Job failed')
    if (record.lease) {
      await releaseWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
    }
    return true
  }

  return false
}

async function reconcileStrandedDispatchJob(record: WorkspaceDispatchJobRecord): Promise<boolean> {
  if (!record.lease && record.status !== 'waiting') {
    await restoreWorkspaceDispatchJob(resetToWaiting(record))
    return true
  }

  if (!record.lease) {
    return false
  }

  const hasLease = await hasWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
  const queue = getBullMQQueueByName(record.queueName)
  const job = await queue.getJob(record.id)
  if (hasLease) {
    if (!job) {
      await releaseWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
      await restoreWorkspaceDispatchJob(resetToWaiting(record))
      return true
    }

    return false
  }

  if (job) {
    if (record.status === 'admitting') {
      await refreshWorkspaceLease(record.lease.workspaceId, record.lease.leaseId, LEASE_TTL_MS)
      await markDispatchJobAdmitted(
        record.id,
        record.lease.workspaceId,
        record.lease.leaseId,
        (record.metadata as { dispatchLeaseExpiresAt?: number }).dispatchLeaseExpiresAt ??
          Date.now()
      )
      await removeWorkspaceJobFromLane(record.workspaceId, record.lane, record.id).catch(
        () => undefined
      )
      return true
    }
    await refreshWorkspaceLease(record.lease.workspaceId, record.lease.leaseId, LEASE_TTL_MS)
    if (record.status === 'admitted') {
      await markDispatchJobRunning(record.id)
      return true
    }
    return false
  }

  await restoreWorkspaceDispatchJob(resetToWaiting(record))
  return true
}

async function reconcileTerminalDispatchLease(
  record: WorkspaceDispatchJobRecord
): Promise<boolean> {
  if ((record.status !== 'completed' && record.status !== 'failed') || !record.lease) {
    return false
  }

  const hasLease = await hasWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
  if (!hasLease) {
    return false
  }

  await releaseWorkspaceLease(record.lease.workspaceId, record.lease.leaseId)
  return true
}

async function reconcileWaitingWorkspaceTracking(
  waitingJobs: WorkspaceDispatchJobRecord[]
): Promise<boolean> {
  let changed = false
  const earliestByWorkspace = new Map<string, number>()

  for (const record of waitingJobs) {
    const readyAt = record.createdAt + (record.delayMs ?? 0)
    const current = earliestByWorkspace.get(record.workspaceId)
    if (current === undefined || readyAt < current) {
      earliestByWorkspace.set(record.workspaceId, readyAt)
    }
  }

  for (const [workspaceId, nextReadyAt] of earliestByWorkspace.entries()) {
    const active = await hasActiveWorkspace(workspaceId)
    if (!active) {
      await ensureWorkspaceActive(workspaceId, nextReadyAt)
      changed = true
    }
  }

  return changed
}

export async function reconcileWorkspaceDispatchState(): Promise<void> {
  const allJobs = await listDispatchJobsByStatuses([
    'waiting',
    'admitting',
    'admitted',
    'running',
    'completed',
    'failed',
  ])

  const activeJobs: WorkspaceDispatchJobRecord[] = []
  const waitingJobs: WorkspaceDispatchJobRecord[] = []
  const terminalJobs: WorkspaceDispatchJobRecord[] = []
  let nonTerminalCount = 0

  for (const job of allJobs) {
    switch (job.status) {
      case 'admitting':
      case 'admitted':
      case 'running':
        activeJobs.push(job)
        nonTerminalCount++
        break
      case 'waiting':
        waitingJobs.push(job)
        nonTerminalCount++
        break
      case 'completed':
      case 'failed':
        terminalJobs.push(job)
        break
    }
  }

  let changed = false

  for (const record of activeJobs) {
    const terminal = await reconcileTerminalBullMQState(record)
    if (terminal) {
      changed = true
      continue
    }

    const restored = await reconcileStrandedDispatchJob(record)
    if (restored) {
      changed = true
    }
  }

  if (await reconcileWaitingWorkspaceTracking(waitingJobs)) {
    changed = true
  }

  for (const record of terminalJobs) {
    if (await reconcileTerminalDispatchLease(record)) {
      changed = true
    }
  }

  await reconcileGlobalQueueDepth(nonTerminalCount).catch((error) => {
    logger.error('Failed to reconcile global queue depth', { error })
  })

  if (changed) {
    logger.info('Workspace dispatch reconciliation updated state', {
      activeJobsInspected: activeJobs.length,
      waitingJobsInspected: waitingJobs.length,
      terminalJobsInspected: terminalJobs.length,
    })
    await wakeWorkspaceDispatcher()
  }
}
