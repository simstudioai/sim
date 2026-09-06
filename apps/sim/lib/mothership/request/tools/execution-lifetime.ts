import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import {
  claimSimToolExecution,
  prepareWorkbenchAccess,
  recordSimSandboxProcess,
  type SimToolExecutionClaim,
  settleSimSandboxProcess,
  settleSimToolExecution,
} from '@/lib/mothership/async-runs/repository'
import { recoverSandboxProcesses } from '@/lib/mothership/request/tools/sandbox-recovery'

const logger = createLogger('MothershipToolExecutionLifetime')

export interface ToolExecutionLifetime {
  claim(runId: string, userId: string): Promise<SimToolExecutionClaim>
  hold<T>(work: Promise<T>): Promise<T>
}

/** The displayed result may finish first; ownership ends only after every retained handler. */
export async function withToolExecutionLifetime<T>(
  toolCallId: string,
  execute: (lifetime: ToolExecutionLifetime) => Promise<T>
): Promise<T> {
  let admitted = false
  let owner: { runId: string; userId: string } | undefined
  const recordedProcesses = new Set<string>()
  let pending = 0
  let resultFinished = false
  let processUnsettled = false
  let settlementAttempted = false
  const settle = async () => {
    if (!admitted || pending > 0 || !resultFinished || processUnsettled || settlementAttempted)
      return
    settlementAttempted = true
    try {
      await settleSimToolExecution(toolCallId)
    } catch (error) {
      /** Retain the unresolved receipt without turning a performed mutation into a retryable failure. */
      logger.warn('Tool execution settlement could not be persisted', {
        toolCallId,
        error: getErrorMessage(error),
      })
    }
  }
  const lifetime: ToolExecutionLifetime = {
    async claim(runId, userId) {
      const claim = await claimSimToolExecution({ toolCallId, runId, userId }).catch(() => {
        throw new Error('Tool could not start because execution admission could not be recorded')
      })
      admitted = claim.outcome === 'claimed'
      if (admitted) owner = { runId, userId }
      return claim
    },
    hold(work) {
      pending++
      const finished = async () => {
        pending--
        await settle()
      }
      void work.then(finished, finished)
      return work
    },
  }
  return observeSandboxExecution(
    {
      hold: (work) => {
        lifetime.hold(work)
      },
      sessionAccess: async (sessionKey, signal) => {
        if (!owner) throw new Error('Workbench access requires an admitted tool execution')
        const input = { ...owner, toolCallId, sessionKey }
        const inspectOwnership = () =>
          prepareWorkbenchAccess(input).catch((error) => {
            logger.warn('Workbench ownership verification failed', {
              toolCallId,
              runId: input.runId,
              error: getErrorMessage(error),
            })
            throw new Error('Workbench access could not be verified for this tool execution')
          })
        let state = await inspectOwnership()
        if (state.processes.length) {
          await recoverSandboxProcesses(
            state.processes,
            AbortSignal.any([signal, AbortSignal.timeout(8000)])
          )
          signal.throwIfAborted()
          state = await inspectOwnership()
        }
        if (state.handlersPending || state.processes.length) {
          throw new Error(
            'Earlier tool work has not finished shutting down; the workbench remains unavailable until recovery completes'
          )
        }
      },
      unsettled: (processId) => {
        if (!processId || !recordedProcesses.has(processId)) processUnsettled = true
      },
      claimProcess: async (process) => {
        if (!owner) throw new Error('Sandbox command requires an admitted tool execution')
        await recordSimSandboxProcess({ toolCallId, ...owner, process }).catch(() => {
          throw new Error('Sandbox command could not start because its ownership is unavailable')
        })
        recordedProcesses.add(process.id)
      },
      settleProcess: async (processId) => {
        await settleSimSandboxProcess(toolCallId, processId).catch(() => {
          logger.warn('Sandbox command settlement could not be persisted', {
            toolCallId,
            processId,
          })
        })
      },
    },
    async () => {
      try {
        return await execute(lifetime)
      } finally {
        resultFinished = true
        await settle()
      }
    }
  )
}
