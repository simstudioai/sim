import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import {
  enqueueWorkspaceDispatchJob,
  getDispatchJobRecord,
  getGlobalQueueDepth,
  getQueuedWorkspaceCount,
  getWorkspaceQueueDepth,
} from '@/lib/core/workspace-dispatch/store'
import {
  WORKSPACE_DISPATCH_LANES,
  type WorkspaceDispatchEnqueueInput,
  type WorkspaceDispatchJobRecord,
} from '@/lib/core/workspace-dispatch/types'
import { DISPATCH_SCAN_RESULTS, dispatchNextAdmissibleWorkspaceJob } from './planner'
import { reconcileWorkspaceDispatchState } from './reconciler'

const logger = createLogger('WorkspaceDispatcher')
const WAIT_POLL_INTERVAL_MS = 250
const RECONCILE_INTERVAL_MS = 30_000
const MAX_QUEUE_PER_WORKSPACE = Number.parseInt(env.DISPATCH_MAX_QUEUE_PER_WORKSPACE ?? '') || 1000
const MAX_QUEUE_GLOBAL = Number.parseInt(env.DISPATCH_MAX_QUEUE_GLOBAL ?? '') || 50_000

let dispatcherRunning = false
let dispatcherWakePending = false
let lastReconcileAt = 0

async function runDispatcherLoop(): Promise<void> {
  if (dispatcherRunning) {
    dispatcherWakePending = true
    return
  }

  dispatcherRunning = true

  try {
    const now = Date.now()
    if (now - lastReconcileAt >= RECONCILE_INTERVAL_MS) {
      await reconcileWorkspaceDispatchState()
      lastReconcileAt = now
    }

    do {
      dispatcherWakePending = false
      const queuedWorkspaces = await getQueuedWorkspaceCount()
      if (queuedWorkspaces === 0) {
        continue
      }

      let admitted = 0
      let scanned = 0
      const loopStartMs = Date.now()

      for (let index = 0; index < queuedWorkspaces; index++) {
        scanned++
        const result = await dispatchNextAdmissibleWorkspaceJob()
        if (result === DISPATCH_SCAN_RESULTS.ADMITTED) {
          admitted++
        }
        if (result === DISPATCH_SCAN_RESULTS.NO_WORKSPACE) {
          break
        }
      }

      if (admitted > 0) {
        dispatcherWakePending = true
      }

      if (admitted > 0 || scanned > 0) {
        logger.info('Dispatcher pass', {
          admitted,
          scanned,
          queuedWorkspaces,
          durationMs: Date.now() - loopStartMs,
        })
      }
    } while (dispatcherWakePending)
  } catch (error) {
    logger.error('Workspace dispatcher loop failed', { error })
  } finally {
    dispatcherRunning = false
  }
}

export class DispatchQueueFullError extends Error {
  readonly statusCode = 503

  constructor(
    readonly scope: 'workspace' | 'global',
    readonly depth: number,
    readonly limit: number
  ) {
    super(
      scope === 'workspace'
        ? `Workspace queue is at capacity (${depth}/${limit})`
        : `Global dispatch queue is at capacity (${depth}/${limit})`
    )
    this.name = 'DispatchQueueFullError'
  }
}

export async function enqueueWorkspaceDispatch(
  input: WorkspaceDispatchEnqueueInput
): Promise<string> {
  const [workspaceDepth, globalDepth] = await Promise.all([
    getWorkspaceQueueDepth(input.workspaceId, WORKSPACE_DISPATCH_LANES),
    getGlobalQueueDepth(),
  ])

  if (workspaceDepth >= MAX_QUEUE_PER_WORKSPACE) {
    logger.warn('Workspace dispatch queue at capacity', {
      workspaceId: input.workspaceId,
      depth: workspaceDepth,
      limit: MAX_QUEUE_PER_WORKSPACE,
    })
    throw new DispatchQueueFullError('workspace', workspaceDepth, MAX_QUEUE_PER_WORKSPACE)
  }

  if (globalDepth >= MAX_QUEUE_GLOBAL) {
    logger.warn('Global dispatch queue at capacity', {
      depth: globalDepth,
      limit: MAX_QUEUE_GLOBAL,
    })
    throw new DispatchQueueFullError('global', globalDepth, MAX_QUEUE_GLOBAL)
  }

  const record = await enqueueWorkspaceDispatchJob(input)
  void runDispatcherLoop()
  return record.id
}

export async function wakeWorkspaceDispatcher(): Promise<void> {
  await runDispatcherLoop()
}

export async function waitForDispatchJob(
  dispatchJobId: string,
  timeoutMs: number
): Promise<WorkspaceDispatchJobRecord> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const record = await getDispatchJobRecord(dispatchJobId)
    if (!record) {
      throw new Error(`Dispatch job not found: ${dispatchJobId}`)
    }

    if (record.status === 'completed' || record.status === 'failed') {
      return record
    }

    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_INTERVAL_MS))
  }

  throw new Error(`Timed out waiting for dispatch job ${dispatchJobId}`)
}
