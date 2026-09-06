import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { CopilotChatSteerBody } from '@/lib/api/contracts/copilot'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import {
  areStreamToolExecutionsSettled,
  getLatestRunForStream,
  getUnsettledClientWorkflowExecutions,
  getUnsettledStreamSandboxProcesses,
  requestRunStop,
} from '@/lib/mothership/async-runs/repository'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  abortActiveStream,
  releasePendingChatStream,
  waitForPendingChatStream,
} from '@/lib/mothership/request/session'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'
import { recoverSandboxProcesses } from '@/lib/mothership/request/tools/sandbox-recovery'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('MothershipRunControls')
const policy = {
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
} as const
export const runControlOperations = {
  abort: defineWorkspaceOperation({ id: 'mothership.runs.abort', ...policy }),
  steer: defineWorkspaceOperation({ id: 'mothership.runs.steer', ...policy }),
} as const

interface RunControlInput {
  streamId: string
  chatId?: string
  workspaceId?: string
}
async function resolveRunContext({
  principal,
  input,
}: {
  principal: SessionPrincipal
  input: RunControlInput
}) {
  const run = await getLatestRunForStream(input.streamId, principal.userId)
  if (!run?.chatId) throw new OrchestrationError('not_found', 'Stream not found')
  return resolveAdmittedRunContext(principal, input, run)
}

async function resolveAdmittedRunContext(
  principal: SessionPrincipal,
  input: RunControlInput,
  run: { chatId: string; workspaceId: string | null }
) {
  if (input.chatId && input.chatId !== run.chatId) {
    throw new OrchestrationError('forbidden', 'Stream does not belong to this chat')
  }
  const chat = await resolveOwnedChatContext(principal, run.chatId)
  if (run.workspaceId && run.workspaceId !== chat.workspaceId) {
    throw new OrchestrationError('not_found', 'Stream not found')
  }
  if (input.workspaceId && input.workspaceId !== chat.workspaceId) {
    throw new OrchestrationError('forbidden', 'Stream does not belong to this workspace')
  }
  return chat
}

async function resolveAbortContext({
  principal,
  input,
}: {
  principal: SessionPrincipal
  input: RunControlInput
}) {
  const run = await getLatestRunForStream(input.streamId, principal.userId)
  if (run?.chatId) return resolveAdmittedRunContext(principal, input, run)
  if (input.chatId) {
    const chat = await resolveOwnedChatContext(principal, input.chatId)
    if (input.workspaceId && input.workspaceId !== chat.workspaceId) {
      throw new OrchestrationError('forbidden', 'Chat does not belong to this workspace')
    }
    return chat
  }
  if (!input.workspaceId) throw new OrchestrationError('not_found', 'Stream not found')
  if ((await getActivelyBannedUserIds([principal.userId])).length > 0) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  return {
    ...(await resolveActiveWorkspaceApplicationContext(input.workspaceId)),
    userId: principal.userId,
    chatId: undefined,
  }
}

export const abortRun = defineAuthorizedWorkspaceUseCase({
  operation: runControlOperations.abort,
  resolveContext: resolveAbortContext,
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    const { streamId } = input
    const { userId, workspaceId } = context
    const run = await requestRunStop({
      streamId,
      userId,
      workspaceId,
      ...(input.chatId ? { chatId: input.chatId } : {}),
    })
    if (!run) return { aborted: true, settled: true }
    /** Admission can win after context lookup; bind its canonical chat before signalling anything. */
    const { chatId } = await resolveAdmittedRunContext(principal, { ...input, workspaceId }, run)
    /** Push delivers promptly; the worker also reconciles Sim's durable intent after an outage. */
    const workerStop = requestExplicitStreamAbort({
      streamId,
      userId,
      chatId,
      workspaceId,
      timeoutMs: 3000,
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
      const processes = await getUnsettledStreamSandboxProcesses(streamId, userId).catch(
        (error) => {
          logger.warn('Stopped stream sandbox ownership could not be read', {
            streamId,
            error: getErrorMessage(error),
          })
          return []
        }
      )
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
      return { aborted: true, settled: false, forceReleased: true }
    }
    const toolsSettled = await areStreamToolExecutionsSettled(streamId, userId).catch((error) => {
      logger.warn('Stopped stream tool settlement could not be verified', {
        streamId,
        error: getErrorMessage(error),
      })
      return false
    })
    return { aborted: true, settled: worker.settled && toolsSettled }
  },
})

export class SteeringNotQueuedError extends Error {
  constructor(readonly goStatus: number) {
    super('Steering was not queued')
  }
}

export const steerRun = defineAuthorizedWorkspaceUseCase({
  operation: runControlOperations.steer,
  resolveContext: (args: { principal: SessionPrincipal; input: CopilotChatSteerBody }) =>
    resolveRunContext(args),
  authorizationOptions: {},
  async execute({ input, context }) {
    const { streamId, steeringId, content } = input
    const { userId, chatId } = context
    let queued = false
    let goStatus = 0
    try {
      const result = await requestStreamSteering({ streamId, userId, chatId, steeringId, content })
      queued = result.queued
      goStatus = result.status
    } catch (error) {
      logger.warn('Steering could not reach worker', { streamId, error: getErrorMessage(error) })
    }
    if (!queued) throw new SteeringNotQueuedError(goStatus)
    try {
      await appendCopilotChatMessages(
        chatId,
        [{ id: steeringId, role: 'user', content, timestamp: new Date().toISOString() }],
        { streamId }
      )
    } catch (error) {
      logger.warn('Queued steering could not be saved to display history', {
        streamId,
        error: getErrorMessage(error),
      })
    }
    return { ok: true, queued: true }
  },
})
