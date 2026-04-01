import { createLogger } from '@sim/logger'
import { getWorkspaceConcurrencyLimit } from '@/lib/billing/workspace-concurrency'
import { type BullMQJobData, getBullMQQueueByName } from '@/lib/core/bullmq'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import {
  claimWorkspaceJob,
  markDispatchJobAdmitted,
  popNextWorkspaceId,
  releaseWorkspaceLease,
  removeWorkspaceIfIdle,
  requeueWorkspaceId,
} from '@/lib/core/workspace-dispatch/store'
import {
  WORKSPACE_DISPATCH_CLAIM_RESULTS,
  WORKSPACE_DISPATCH_LANES,
  type WorkspaceDispatchJobRecord,
} from '@/lib/core/workspace-dispatch/types'

const logger = createLogger('WorkspaceDispatchPlanner')

const LEASE_TTL_MS = 15 * 60 * 1000
const WORKSPACE_CLAIM_LOCK_TTL_SECONDS = 10

export const DISPATCH_SCAN_RESULTS = {
  NO_WORKSPACE: 'no_workspace',
  NO_PROGRESS: 'no_progress',
  ADMITTED: 'admitted',
} as const

export type DispatchScanResult = (typeof DISPATCH_SCAN_RESULTS)[keyof typeof DISPATCH_SCAN_RESULTS]

function attachDispatchMetadata(
  bullmqPayload: unknown,
  record: WorkspaceDispatchJobRecord,
  leaseId: string,
  leaseExpiresAt: number
): BullMQJobData<unknown> {
  if (
    bullmqPayload &&
    typeof bullmqPayload === 'object' &&
    'payload' in bullmqPayload &&
    'metadata' in bullmqPayload
  ) {
    const data = bullmqPayload as BullMQJobData<unknown>
    return {
      payload: data.payload,
      metadata: {
        ...(data.metadata ?? {}),
        dispatchJobId: record.id,
        dispatchWorkspaceId: record.workspaceId,
        dispatchLeaseId: leaseId,
        dispatchLeaseExpiresAt: leaseExpiresAt,
      },
    }
  }

  return {
    payload: bullmqPayload,
    metadata: {
      ...record.metadata,
      dispatchJobId: record.id,
      dispatchWorkspaceId: record.workspaceId,
      dispatchLeaseId: leaseId,
      dispatchLeaseExpiresAt: leaseExpiresAt,
    },
  }
}

async function finalizeAdmittedJob(
  record: WorkspaceDispatchJobRecord,
  leaseId: string,
  leaseExpiresAt: number
): Promise<void> {
  try {
    await getBullMQQueueByName(record.queueName).add(
      record.bullmqJobName,
      attachDispatchMetadata(record.bullmqPayload, record, leaseId, leaseExpiresAt),
      {
        jobId: record.id,
        attempts: record.maxAttempts,
        priority: record.priority,
      }
    )

    await markDispatchJobAdmitted(record.id, record.workspaceId, leaseId, leaseExpiresAt)
  } catch (error) {
    await releaseWorkspaceLease(record.workspaceId, leaseId).catch(() => undefined)
    throw error
  }
}

export async function dispatchNextAdmissibleWorkspaceJob(): Promise<DispatchScanResult> {
  const workspaceId = await popNextWorkspaceId()
  if (!workspaceId) {
    return DISPATCH_SCAN_RESULTS.NO_WORKSPACE
  }

  const lockValue = `lock_${crypto.randomUUID()}`
  try {
    const lockKey = `workspace-dispatch:claim-lock:${workspaceId}`
    const acquired = await acquireLock(lockKey, lockValue, WORKSPACE_CLAIM_LOCK_TTL_SECONDS)
    if (!acquired) {
      await requeueWorkspaceId(workspaceId)
      return DISPATCH_SCAN_RESULTS.NO_PROGRESS
    }

    const limit = await getWorkspaceConcurrencyLimit(workspaceId)
    const leaseId = `lease_${crypto.randomUUID()}`
    const claimResult = await claimWorkspaceJob(workspaceId, {
      lanes: WORKSPACE_DISPATCH_LANES,
      concurrencyLimit: limit,
      leaseId,
      now: Date.now(),
      leaseTtlMs: LEASE_TTL_MS,
    })

    switch (claimResult.type) {
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.LIMIT_REACHED:
        logger.debug('Workspace concurrency limit reached', { workspaceId, limit })
        await requeueWorkspaceId(workspaceId)
        return DISPATCH_SCAN_RESULTS.NO_PROGRESS
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.DELAYED:
        logger.debug('Workspace has only delayed jobs', {
          workspaceId,
          nextReadyAt: claimResult.nextReadyAt,
        })
        return DISPATCH_SCAN_RESULTS.NO_PROGRESS
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.EMPTY:
        await removeWorkspaceIfIdle(workspaceId, WORKSPACE_DISPATCH_LANES)
        return DISPATCH_SCAN_RESULTS.NO_PROGRESS
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.ADMITTED:
        logger.info('Admitting workspace job', {
          workspaceId,
          dispatchJobId: claimResult.record.id,
          lane: claimResult.record.lane,
          queueName: claimResult.record.queueName,
        })
        await finalizeAdmittedJob(
          claimResult.record,
          claimResult.leaseId,
          claimResult.leaseExpiresAt
        )
        return DISPATCH_SCAN_RESULTS.ADMITTED
    }
  } catch (error) {
    logger.error('Failed to dispatch workspace job', { workspaceId, error })
    await requeueWorkspaceId(workspaceId)
    return DISPATCH_SCAN_RESULTS.NO_PROGRESS
  } finally {
    await releaseLock(`workspace-dispatch:claim-lock:${workspaceId}`, lockValue).catch(
      () => undefined
    )
  }
}
