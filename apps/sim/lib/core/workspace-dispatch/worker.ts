import { createLogger } from '@sim/logger'
import {
  markDispatchJobCompleted,
  markDispatchJobFailed,
  markDispatchJobRunning,
  refreshWorkspaceLease,
  releaseWorkspaceLease,
  wakeWorkspaceDispatcher,
} from '@/lib/core/workspace-dispatch'

const logger = createLogger('WorkspaceDispatchWorker')

interface DispatchRuntimeMetadata {
  dispatchJobId: string
  dispatchWorkspaceId: string
  dispatchLeaseId: string
}

interface RunDispatchedJobOptions {
  isFinalAttempt?: boolean
  leaseTtlMs?: number
}

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000
const LEASE_HEARTBEAT_INTERVAL_MS = 60_000

export function getDispatchRuntimeMetadata(metadata: unknown): DispatchRuntimeMetadata | null {
  if (!metadata || typeof metadata !== 'object') {
    return null
  }

  const value = metadata as Partial<DispatchRuntimeMetadata>
  if (!value.dispatchJobId || !value.dispatchWorkspaceId || !value.dispatchLeaseId) {
    return null
  }

  return {
    dispatchJobId: value.dispatchJobId,
    dispatchWorkspaceId: value.dispatchWorkspaceId,
    dispatchLeaseId: value.dispatchLeaseId,
  }
}

export async function runDispatchedJob<T>(
  metadata: unknown,
  run: () => Promise<T>,
  options: RunDispatchedJobOptions = {}
): Promise<T> {
  const dispatchMetadata = getDispatchRuntimeMetadata(metadata)

  if (!dispatchMetadata) {
    return run()
  }

  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const isFinalAttempt = options.isFinalAttempt ?? true

  await markDispatchJobRunning(dispatchMetadata.dispatchJobId)

  let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
    void refreshWorkspaceLease(
      dispatchMetadata.dispatchWorkspaceId,
      dispatchMetadata.dispatchLeaseId,
      leaseTtlMs
    ).catch((error) => {
      logger.error('Failed to refresh dispatch lease', { error, dispatchMetadata })
    })
  }, LEASE_HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref()

  let succeeded = false
  try {
    const result = await run()
    succeeded = true
    await markDispatchJobCompleted(dispatchMetadata.dispatchJobId, result)
    return result
  } catch (error) {
    if (isFinalAttempt && !succeeded) {
      await markDispatchJobFailed(
        dispatchMetadata.dispatchJobId,
        error instanceof Error ? error.message : String(error)
      )
    }
    throw error
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    const shouldReleaseLease = succeeded || isFinalAttempt
    if (shouldReleaseLease) {
      try {
        await releaseWorkspaceLease(
          dispatchMetadata.dispatchWorkspaceId,
          dispatchMetadata.dispatchLeaseId
        )
        await wakeWorkspaceDispatcher()
      } catch (error) {
        logger.error('Failed to release dispatch lease', { error, dispatchMetadata })
      }
    }
  }
}
