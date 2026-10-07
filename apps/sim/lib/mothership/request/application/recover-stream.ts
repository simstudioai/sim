import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { buildOnComplete, buildOnError } from '@/lib/mothership/chat/completion'
import { restoreBillingAdmission } from '@/lib/mothership/request/lifecycle/admission'
import {
  claimRunController,
  planRecovery,
} from '@/lib/mothership/request/lifecycle/controller-ownership'
import { StreamRecoveryConfigSchema } from '@/lib/mothership/request/lifecycle/recovery-config'
import { createSSEStream } from '@/lib/mothership/request/lifecycle/start'
import { isTerminalStreamStatus } from '@/lib/mothership/request/session'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { getLatestSeq, readEvents } from '@/lib/mothership/request/session/buffer'
import { assertChatStreamLease } from '@/lib/mothership/request/session/controller-lease'
import { eventToStreamEvent } from '@/lib/mothership/request/session/event'
import { startsAtReplayHead } from '@/lib/mothership/request/session/recovery'
import { StreamRecoveryExhaustedError } from '@/lib/mothership/request/session/turn-failure'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipStreamRecovery')

export const readChatStream = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.runs.reconnect',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.runs.reconnect',
    minimumRole: 'member',
    capability: 'copilot.use',
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
    if (
      (run.workspaceId ?? null) !== (chat.workspaceId ?? null) ||
      (run.organizationId ?? null) !== (chat.organizationId ?? null)
    )
      throw new OrchestrationError('not_found', 'Stream not found')
    return { ...chat, run }
  },
  authorizationOptions: {},
  async execute({ context }) {
    const { run, chatId, userId, workspaceId, organizationId } = context
    if (isTerminalStreamStatus(run.status)) return run
    const saved = run.requestContext as Record<string, unknown> | null
    const config = StreamRecoveryConfigSchema.safeParse(saved?.recovery)
    if (!config.success || typeof saved?.controllerToken !== 'string') return run
    const intent = config.data.request
    if (
      intent.userId !== userId ||
      intent.workspaceId !== workspaceId ||
      intent.organizationId !== organizationId ||
      (organizationId && intent.mode !== context.mode) ||
      intent.chatId !== chatId ||
      intent.messageId !== run.streamId
    ) {
      throw new OrchestrationError('validation', 'Saved stream identity does not match its chat')
    }
    const plan = planRecovery(saved.recoveryBackoff, Date.now())
    if (plan.kind === 'wait') return run
    if (!(await acquirePendingChatStream(chatId, run.streamId, 0))) return run
    const lease = getLocalChatStreamLease(chatId, run.streamId)!
    try {
      if (isHosted && !config.data.billingAdmission)
        throw new OrchestrationError(
          'forbidden',
          'Hosted recovery is missing its original billing admission'
        )
      const restoredAdmission = config.data.billingAdmission
        ? restoreBillingAdmission(config.data.billingAdmission, {
            userId,
            workspaceId,
            organizationId,
          })
        : undefined
      const [events, billingAttribution, userPermission] = await Promise.all([
        readEvents(run.streamId, '0'),
        restoredAdmission
          ? Promise.resolve(restoredAdmission.attribution)
          : organizationId
            ? resolveOrganizationBillingAttribution({ actorUserId: userId, organizationId })
            : resolveBillingAttribution({ actorUserId: userId, workspaceId: workspaceId! }),
        workspaceId
          ? getUserEntityPermissions(userId, 'workspace', workspaceId)
          : Promise.resolve(undefined),
      ])
      if (workspaceId && !userPermission)
        throw new OrchestrationError('forbidden', 'Workspace access revoked')
      /**
       * A ring that lost its head is treated like an expired one: the controller starts
       * from an empty context and re-attaches with an empty receipt, so the worker re-sends
       * the whole response and re-hands its parked calls. Rebuilding from the tail would
       * persist a truncated turn. Without a recovered event, numbering resumes past the
       * stream's counter, which outlives unreadable entries still holding earlier seqs.
       */
      const ringIntact = startsAtReplayHead(events[0]?.seq)
      const recoveredEvents = ringIntact ? events : []
      const lastEvent = recoveredEvents.at(-1)
      const resumeSeq = lastEvent ? lastEvent.seq : ((await getLatestSeq(run.streamId)) ?? 0)
      /**
       * Claim last: everything before it can fail without touching the run, so a takeover
       * that cannot start neither spends the recovery budget nor refreshes the run, and
       * an exhausted claim always reaches the terminal path below.
       */
      await assertChatStreamLease(lease)
      if (
        !(await claimRunController({
          runId: run.id,
          chatId,
          previousToken: saved.controllerToken,
          token: lease.value,
          recoveryBackoff: plan.backoff,
        }))
      ) {
        await releasePendingChatStream(chatId, run.streamId, lease)
        return (await getLatestRunForStream(run.streamId, userId)) ?? run
      }
      logger.info('Claimed stream run for recovery', {
        runId: run.id,
        streamId: run.streamId,
        attempt: plan.backoff.attempts,
        exhausted: plan.kind === 'exhausted',
      })
      const requestId = typeof saved?.requestId === 'string' ? saved.requestId : generateId()
      const completion = {
        chatId,
        userMessageId: run.streamId,
        requestId,
        workspaceId,
        organizationId,
        userId,
        requestMode:
          intent.mode === 'plan'
            ? ('plan' as const)
            : intent.mode === 'assistant'
              ? ('assistant' as const)
              : ('agent' as const),
        notifyWorkspaceStatus: true,
        runController: { id: run.id, token: lease.value },
      }
      const stream = createSSEStream({
        userId,
        workspaceId,
        organizationId,
        chatId,
        streamId: run.streamId,
        executionId: run.executionId,
        runId: run.id,
        requestId,
        requestPayload: intent,
        currentChat: null,
        message: '',
        titleModel: '',
        resumeSeq,
        ...(plan.kind === 'exhausted' ? { failure: new StreamRecoveryExhaustedError() } : {}),
        orchestrateOptions: {
          userId,
          workspaceId,
          organizationId,
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
            events: recoveredEvents.map(eventToStreamEvent),
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
