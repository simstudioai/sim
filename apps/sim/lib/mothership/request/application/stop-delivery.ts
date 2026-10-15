import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { settleStoppedRunWithoutController } from '@/lib/mothership/async-runs/orphaned-runs'
import {
  getUnsettledClientWorkflowExecutions,
  getUnsettledStreamSandboxProcesses,
  type StoppedRun,
} from '@/lib/mothership/async-runs/repository'
import {
  abortActiveStream,
  releasePendingChatStream,
  waitForPendingChatStream,
} from '@/lib/mothership/request/session'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'
import { recoverSandboxProcesses } from '@/lib/mothership/request/tools/sandbox-recovery'

const logger = createLogger('MothershipStopDelivery')

interface RunStopDelivery {
  /** The run's controller let go of its chat; otherwise its lock was force-released. */
  settled: boolean
  /** The worker acknowledged the Stop as settled. */
  workerSettled: boolean
}

interface RunStopDeliveryOptions {
  /** The worker endpoint, resolved while the run's user still exists. */
  mothershipBaseURL?: string
}

/**
 * Delivers a Stop that is already durable to everything still acting on the run: the
 * desktop, the worker, this process's controller, the run's client workflows and sandbox
 * commands. Each effect is best-effort; the worker also reconciles Sim's durable intent on
 * its next heartbeat.
 */
export async function deliverRunStop(
  run: StoppedRun,
  options: RunStopDeliveryOptions = {}
): Promise<RunStopDelivery> {
  const { streamId, userId, chatId } = run
  /** Admission is closed: the device re-reads its inbox and cancels what it is running. */
  if (run.desktopDeviceId) ringDesktopInbox(run.desktopDeviceId, 'cancel')
  /** Push delivers promptly; the worker also reconciles Sim's durable intent after an outage. */
  const workerStop = requestExplicitStreamAbort({
    streamId,
    userId,
    chatId,
    timeoutMs: 6000,
    mothershipBaseURL: options.mothershipBaseURL,
  }).catch((error) => {
    logger.warn('Stop saved; worker delivery awaits reconciliation', {
      streamId,
      error: getErrorMessage(error),
    })
    return { settled: false }
  })
  await abortActiveStream(streamId)
  const cancelClientWorkflows = async () => {
    const executionIds = await getUnsettledClientWorkflowExecutions(streamId, userId)
    await Promise.all(
      executionIds.map(async (executionId) => {
        /** The execution route reserved these IDs before recording ownership; no client result is trusted. */
        abortManualExecution(executionId)
        await markExecutionCancelled(executionId)
      })
    )
  }
  const recoverCommands = async () => {
    const signal = AbortSignal.timeout(8000)
    const processes = await getUnsettledStreamSandboxProcesses(streamId, userId).catch((error) => {
      logger.warn('Stopped stream sandbox ownership could not be read', {
        streamId,
        error: getErrorMessage(error),
      })
      return []
    })
    await recoverSandboxProcesses(processes, signal)
  }
  const [settled, worker] = await Promise.all([
    waitForPendingChatStream(chatId, 8000, streamId),
    workerStop,
    recoverCommands(),
    cancelClientWorkflows().catch((error) => {
      logger.warn('Stopped stream workflow cancellation could not be delivered', {
        streamId,
        error: getErrorMessage(error),
      })
    }),
  ])
  if (!settled) {
    await releasePendingChatStream(chatId, streamId)
    logger.warn('Stopped stream did not settle; released its chat lock', { chatId, streamId })
  }
  /** A run with no controller left, or none to begin with, has nothing else to settle it. */
  await settleStoppedRunWithoutController(run.id).catch((error) => {
    logger.warn('Stopped run without a controller could not be settled', {
      streamId,
      error: getErrorMessage(error),
    })
  })
  return { settled, workerSettled: worker.settled }
}

/**
 * Starts delivering the Stop a deletion or access removal committed for each of its live
 * runs, without holding up the removal: a controller can take seconds to let go, and run
 * control already answers Stop for every run the removal ended. Never throws.
 */
export function deliverRunStops(runs: StoppedRun[], options: RunStopDeliveryOptions = {}): void {
  for (const run of runs) {
    deliverRunStop(run, options).catch((error) =>
      logger.warn('Stop for a removed run was not delivered', {
        streamId: run.streamId,
        error: getErrorMessage(error),
      })
    )
  }
}
