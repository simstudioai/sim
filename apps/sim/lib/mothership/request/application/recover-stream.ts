import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { buildOnComplete, buildOnError } from '@/lib/mothership/chat/completion'
import { claimRunController } from '@/lib/mothership/request/lifecycle/controller-ownership'
import { StreamRecoveryConfigSchema } from '@/lib/mothership/request/lifecycle/recovery-config'
import { createSSEStream } from '@/lib/mothership/request/lifecycle/start'
import { isTerminalStreamStatus } from '@/lib/mothership/request/session'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { readEvents } from '@/lib/mothership/request/session/buffer'
import { assertChatStreamLease } from '@/lib/mothership/request/session/controller-lease'
import { eventToStreamEvent } from '@/lib/mothership/request/session/event'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipStreamRecovery')

export const readChatStream = defineAuthorizedWorkspaceUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.runs.reconnect',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { streamId: string }
  }) {
    const run = await getLatestRunForStream(input.streamId, principal.userId)
    if (!run?.chatId) throw new OrchestrationError('not_found', 'Stream not found')
    const chat = await resolveOwnedChatContext(principal, run.chatId)
    if (run.workspaceId !== chat.workspaceId)
      throw new OrchestrationError('not_found', 'Stream not found')
    return { ...chat, run }
  },
  authorizationOptions: {},
  async execute({ context }) {
    const { run, chatId, userId, workspaceId } = context
    if (isTerminalStreamStatus(run.status)) return run
    const saved = run.requestContext as Record<string, unknown> | null
    const config = StreamRecoveryConfigSchema.safeParse(saved?.recovery)
    if (!config.success || typeof saved?.controllerToken !== 'string') return run
    const intent = config.data.request
    if (
      intent.userId !== userId ||
      intent.workspaceId !== workspaceId ||
      intent.chatId !== chatId ||
      intent.messageId !== run.streamId
    ) {
      throw new OrchestrationError('validation', 'Saved stream identity does not match its chat')
    }
    if (!(await acquirePendingChatStream(chatId, run.streamId, 0))) return run
    const lease = getLocalChatStreamLease(chatId, run.streamId)!
    try {
      await assertChatStreamLease(lease)
      if (
        !(await claimRunController({
          runId: run.id,
          chatId,
          previousToken: saved.controllerToken,
          token: lease.value,
        }))
      ) {
        await releasePendingChatStream(chatId, run.streamId, lease)
        return (await getLatestRunForStream(run.streamId, userId)) ?? run
      }
      const [events, billingAttribution, userPermission] = await Promise.all([
        readEvents(run.streamId, '0'),
        resolveBillingAttribution({ actorUserId: userId, workspaceId }),
        getUserEntityPermissions(userId, 'workspace', workspaceId),
      ])
      if (!userPermission) throw new OrchestrationError('forbidden', 'Workspace access revoked')
      const requestId = typeof saved?.requestId === 'string' ? saved.requestId : crypto.randomUUID()
      const completion = {
        chatId,
        userMessageId: run.streamId,
        requestId,
        workspaceId,
        notifyWorkspaceStatus: true,
        runController: { id: run.id, token: lease.value },
      }
      const stream = createSSEStream({
        userId,
        workspaceId,
        chatId,
        streamId: run.streamId,
        executionId: run.executionId,
        runId: run.id,
        requestId,
        requestPayload: intent,
        currentChat: null,
        isNewChat: false,
        message: '',
        titleModel: '',
        resumeSeq: events.at(-1)?.seq ?? 0,
        orchestrateOptions: {
          userId,
          workspaceId,
          chatId,
          runId: run.id,
          executionId: run.executionId,
          workflowId: run.workflowId ?? undefined,
          goRoute: config.data.goRoute,
          billingAttribution,
          userPermission: userPermission ?? undefined,
          interactive: true,
          autoExecuteTools: true,
          clientToolPickupExpected: config.data.clientToolPickupExpected,
          recovery: {
            ...config.data,
            streamId: run.streamId,
            events: events.map(eventToStreamEvent),
          },
          onComplete: buildOnComplete(completion),
          onError: buildOnError(completion),
        },
      })
      // Its lifecycle is detached, just like the original POST after a browser disconnect.
      void stream
        .cancel()
        .catch((error) =>
          logger.warn('Recovered stream cleanup failed', { error: getErrorMessage(error) })
        )
      return run
    } catch (error) {
      await releasePendingChatStream(chatId, run.streamId, lease)
      throw error
    }
  },
})
