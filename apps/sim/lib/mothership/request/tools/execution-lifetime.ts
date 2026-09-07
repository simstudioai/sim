import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'
import {
  SIM_TOOL_EXECUTION_HEARTBEAT_MS,
  SimToolExecutionLeaseLostError,
  type SimToolExecutionOwner,
} from '@/lib/mothership/async-runs/execution-lease'
import {
  type CompleteAsyncToolCallInput,
  claimSimToolExecution,
  completeAsyncToolCall,
  completeOwnedSimToolCall,
  prepareWorkbenchAccess,
  recordSimSandboxProcess,
  renewSimToolExecutionLease,
  type SimToolExecutionClaim,
  settleSimSandboxProcess,
  settleSimToolExecution,
} from '@/lib/mothership/async-runs/repository'
import { recoverSandboxProcesses } from '@/lib/mothership/request/tools/sandbox-recovery'

const logger = createLogger('MothershipToolExecutionLifetime')

export interface ToolExecutionLifetime {
  readonly signal: AbortSignal
  complete(input: CompleteAsyncToolCallInput): Promise<void>
  claim(runId: string, userId: string): Promise<SimToolExecutionClaim>
  hold<T>(work: Promise<T>): Promise<T>
}

/** The displayed result may finish first; ownership ends only after every retained handler. */
export async function withToolExecutionLifetime<T>(
  toolCallId: string,
  execute: (lifetime: ToolExecutionLifetime) => Promise<T>
): Promise<T> {
  let admitted = false
  let owner: SimToolExecutionOwner | undefined
  const ownerToken = generateId()
  const leaseAbort = new AbortController()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let renewing = false
  const recordedProcesses = new Set<string>()
  let pending = 0
  let resultFinished = false
  let processUnsettled = false
  let settlementAttempted = false
  const settle = async () => {
    if (!admitted || pending > 0 || !resultFinished || settlementAttempted) return
    clearInterval(heartbeat)
    if (processUnsettled) return
    settlementAttempted = true
    try {
      await settleSimToolExecution(toolCallId, ownerToken)
    } catch (error) {
      /** Retain the unresolved receipt without turning a performed mutation into a retryable failure. */
      logger.warn('Tool execution settlement could not be persisted', {
        toolCallId,
        error: getErrorMessage(error),
      })
    }
  }
  const lifetime: ToolExecutionLifetime = {
    signal: leaseAbort.signal,
    async complete(input) {
      if (owner) await completeOwnedSimToolCall(input, owner.ownerToken)
      else await completeAsyncToolCall(input)
    },
    async claim(runId, userId) {
      const claim = await claimSimToolExecution({ toolCallId, runId, userId, ownerToken }).catch(
        () => {
          throw new Error('Tool could not start because execution admission could not be recorded')
        }
      )
      admitted = claim.outcome === 'claimed'
      if (admitted) {
        owner = { toolCallId, runId, userId, ownerToken }
        heartbeat = setInterval(async () => {
          if (renewing || !owner) return
          renewing = true
          try {
            if (!(await renewSimToolExecutionLease(owner)))
              throw new SimToolExecutionLeaseLostError()
          } catch (error) {
            clearInterval(heartbeat)
            leaseAbort.abort(new SimToolExecutionLeaseLostError())
            logger.warn('Tool execution lease was lost', {
              toolCallId,
              error: getErrorMessage(error),
            })
          } finally {
            renewing = false
          }
        }, SIM_TOOL_EXECUTION_HEARTBEAT_MS)
        heartbeat.unref?.()
      }
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
        leaseAbort.signal.throwIfAborted()
        if (!owner) throw new Error('Workbench access requires an admitted tool execution')
        const input = { ...owner, sessionKey }
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
            AbortSignal.any([signal, leaseAbort.signal, AbortSignal.timeout(8000)])
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
        leaseAbort.signal.throwIfAborted()
        if (!owner) throw new Error('Sandbox command requires an admitted tool execution')
        await recordSimSandboxProcess({ ...owner, process }).catch(() => {
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
