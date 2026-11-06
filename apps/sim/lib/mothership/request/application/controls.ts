import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { CopilotChatSteerBody } from '@/lib/api/contracts/copilot'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  areStreamToolExecutionsSettled,
  getLatestRunForStream,
  requestRunStop,
} from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  type OwnedChatContextOptions,
  resolveOwnedChatContext,
} from '@/lib/mothership/chat/application/context'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  deliverRunStop,
  readStoppedRunWork,
} from '@/lib/mothership/request/application/stop-delivery'
import { requestStreamSteering } from '@/lib/mothership/request/session/steer'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const logger = createLogger('MothershipRunControls')
const policy = {
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
} as const
export const runControlOperations = {
  // permission-group-exempt: an owner must be able to stop existing work after Copilot access is withheld
  abort: defineWorkspaceOperation({
    id: 'mothership.runs.abort',
    capability: 'none',
    ...policy,
  }),
  steer: defineWorkspaceOperation({
    id: 'mothership.runs.steer',
    capability: 'copilot.use',
    ...policy,
  }),
} as const

interface RunControlInput {
  streamId: string
  chatId?: string
  workspaceId?: string
  organizationId?: string
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
  run: { chatId: string; workspaceId: string | null; organizationId?: string | null },
  options: OwnedChatContextOptions = {}
) {
  if (input.chatId && input.chatId !== run.chatId) {
    throw new OrchestrationError('forbidden', 'Stream does not belong to this chat')
  }
  const chat = await resolveOwnedChatContext(principal, run.chatId, options)
  if (
    (run.workspaceId ?? null) !== (chat.workspaceId ?? null) ||
    (run.organizationId ?? null) !== (chat.organizationId ?? null)
  ) {
    throw new OrchestrationError('not_found', 'Stream not found')
  }
  if (input.workspaceId && input.workspaceId !== chat.workspaceId) {
    throw new OrchestrationError('forbidden', 'Stream does not belong to this workspace')
  }
  if (input.organizationId && input.organizationId !== chat.organizationId) {
    throw new OrchestrationError('forbidden', 'Stream does not belong to this organization')
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
  /**
   * An owner may stop a run already admitted for them even after their account is blocked. A
   * blocked account cannot admit a run, so a Stop recorded ahead of admission keeps the ban check.
   */
  if (run?.chatId)
    return resolveAdmittedRunContext(principal, input, run, { allowBlockedOwner: true })
  if (input.chatId) {
    const chat = await resolveOwnedChatContext(principal, input.chatId)
    if (input.workspaceId && input.workspaceId !== chat.workspaceId) {
      throw new OrchestrationError('forbidden', 'Chat does not belong to this workspace')
    }
    if (input.organizationId && input.organizationId !== chat.organizationId) {
      throw new OrchestrationError('forbidden', 'Chat does not belong to this organization')
    }
    return chat
  }
  if (Boolean(input.workspaceId) === Boolean(input.organizationId))
    throw new OrchestrationError('not_found', 'Stream not found')
  if ((await getActivelyBannedUserIds([principal.userId])).length > 0) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  if (input.organizationId)
    return {
      organizationId: input.organizationId,
      workspaceId: undefined,
      userId: principal.userId,
      chatId: undefined,
    }
  return {
    ...(await resolveActiveWorkspaceApplicationContext(input.workspaceId!)),
    organizationId: undefined,
    userId: principal.userId,
    chatId: undefined,
  }
}

export const abortRun = defineAuthorizedChatUseCase({
  operation: runControlOperations.abort,
  /** permission-group-exempt: stopping owned execution remains available after Assistant access is withheld. */
  organizationOperation: defineOrganizationOperation({
    id: runControlOperations.abort.id,
    minimumRole: 'member',
    capability: runControlOperations.abort.capability,
    principalKinds: ['session'],
  }),
  resolveContext: resolveAbortContext,
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    const { streamId } = input
    const { userId, workspaceId, organizationId } = context
    const run = await requestRunStop({
      streamId,
      userId,
      workspaceId,
      organizationId,
      ...(input.chatId ? { chatId: input.chatId } : {}),
    })
    if (!run) return { aborted: true, settled: true }
    /** Admission can win after context lookup; bind its canonical chat before signalling anything. */
    const { chatId } = await resolveAdmittedRunContext(
      principal,
      { ...input, workspaceId, organizationId },
      run,
      { allowBlockedOwner: true }
    )
    /** Read alongside the signals, which need none of it. */
    const work = readStoppedRunWork(streamId, userId)
    const { settled, workerSettled } = await deliverRunStop(
      { id: run.id, streamId, userId, chatId, desktopDeviceId: run.desktopDeviceId },
      work
    )
    if (!settled) return { aborted: true, settled: false, forceReleased: true }
    const toolsSettled = await areStreamToolExecutionsSettled(streamId, userId).catch((error) => {
      logger.warn('Stopped stream tool settlement could not be verified', {
        streamId,
        error: getErrorMessage(error),
      })
      return false
    })
    return { aborted: true, settled: workerSettled && toolsSettled }
  },
})

export class SteeringNotQueuedError extends Error {
  constructor(readonly goStatus: number) {
    super('Steering was not queued')
  }
}

export const steerRun = defineAuthorizedChatUseCase({
  operation: runControlOperations.steer,
  organizationOperation: defineOrganizationOperation({
    id: runControlOperations.steer.id,
    minimumRole: 'member',
    capability: runControlOperations.steer.capability,
    principalKinds: ['session'],
  }),
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
