import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { stopE2BSessionProcess } from '@/lib/execution/remote-sandbox/e2b'
import type { SessionProcessIdentity } from '@/lib/execution/remote-sandbox/session-process'
import { settleSimSandboxProcess } from '@/lib/mothership/async-runs/repository'

const logger = createLogger('MothershipSandboxRecovery')

/** A failed provider call leaves its durable ownership receipt unresolved. */
export async function recoverSandboxProcesses(
  processes: Array<SessionProcessIdentity & { toolCallId: string }>,
  signal: AbortSignal
): Promise<void> {
  await Promise.all(
    processes.map(async (process) => {
      try {
        signal.throwIfAborted()
        await stopE2BSessionProcess(process, signal)
        await settleSimSandboxProcess(process.toolCallId, process.id)
      } catch (error) {
        logger.warn('Sandbox command remains unresolved', {
          toolCallId: process.toolCallId,
          processId: process.id,
          error: getErrorMessage(error),
        })
      }
    })
  )
}
