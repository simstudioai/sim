import {
  type DelegatedPrincipal,
  type OrganizationDelegatedPrincipal,
  type Principal,
  resolvePrincipalSubjectUserId,
  type SessionPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/attribution'
import { defineWorkspaceOperation, NoWorkspaceAccessError } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getLatestRunForStream,
  hasLiveSimToolExecution,
  revokeExhaustedSimToolExecutions,
} from '@/lib/mothership/async-runs/repository'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { buildOnComplete, buildOnError } from '@/lib/mothership/chat/completion'
import { restoreBillingAdmission } from '@/lib/mothership/request/lifecycle/admission'
import {
  claimRunController,
  planRecovery,
} from '@/lib/mothership/request/lifecycle/controller-ownership'
import { parseRecordedSecretAuthority } from '@/lib/mothership/request/lifecycle/durable-run'
import {
  RESOURCE_AUTHORING_VERSION,
  StreamRecoveryConfigSchema,
} from '@/lib/mothership/request/lifecycle/recovery-config'
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
import { NO_SECRET_AUTHORITY } from '@/lib/mothership/secret-mount-policy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipStreamRecovery')

/** The delegation audience Sim's own takeover of an abandoned run acts under. */
export const RUN_TAKEOVER_AUDIENCE = 'sim:copilot-run-takeover'

type StreamRunContext = Awaited<ReturnType<typeof resolveOwnedChatContext>> & {
  run: NonNullable<Awaited<ReturnType<typeof getLatestRunForStream>>>
}

async function resolveStreamRunContext({
  principal,
  input,
}: {
  principal: Principal
  input: { streamId: string }
}): Promise<StreamRunContext> {
  const userId = resolvePrincipalSubjectUserId(principal)
  const run = userId ? await getLatestRunForStream(input.streamId, userId) : null
  if (!run?.chatId) throw new OrchestrationError('not_found', 'Stream not found')
  const chat = await resolveOwnedChatContext(principal, run.chatId)
  if (
    (run.workspaceId ?? null) !== (chat.workspaceId ?? null) ||
    (run.organizationId ?? null) !== (chat.organizationId ?? null)
  )
    throw new OrchestrationError('not_found', 'Stream not found')
  return { ...chat, run }
}

/** The browser's reconnect, which takes over the run when its controller is gone. */
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
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { streamId: string }
  }) => resolveStreamRunContext({ principal, input }),
  authorizationOptions: {},
  execute: ({ context }) => recoverStreamRun(context),
})

/**
 * Sim's own takeover of a run whose controller is gone, acting as the run's user with no
 * browser attached. It re-checks that user's current access exactly as a reconnect does.
 */
export const takeOverStreamRun = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.runs.takeover',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    contentDelivery: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.runs.takeover',
    contentDelivery: 'none',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegationAudience: RUN_TAKEOVER_AUDIENCE,
    delegatedServices: ['copilot'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: { streamId: string }
  }) => resolveStreamRunContext({ principal, input }),
  authorizationOptions: {
    delegation: {
      audience: RUN_TAKEOVER_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' &&
        principal.workspaceId === context.workspaceId &&
        principal.resourceScope?.chatId === context.chatId,
    },
  },
  execute: ({ context, request }) => recoverStreamRun(context, request?.signal),
})

/**
 * Takes over the run when no controller holds its chat and none of its Sim tools is still
 * running, then drives it on from the worker's re-attach. Anything else returns the run as is.
 * An aborted `admission` declines the run before its controller is claimed.
 */
async function recoverStreamRun(context: StreamRunContext, admission?: AbortSignal) {
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
  /** A dead owner's lease lapses within a minute; then its call can be run again. */
  if (await hasLiveSimToolExecution(run.id)) return run
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
    if (workspaceId && !userPermission) throw new NoWorkspaceAccessError()
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
    await revokeExhaustedSimToolExecutions(run.id)
    await assertChatStreamLease(lease)
    /** The last point a shutting-down caller can still decline the run without owning it. */
    admission?.throwIfAborted()
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
    /**
     * An unattended turn was admitted for nobody to answer and with the secrets its schedule
     * mounts, so its recovered leg keeps both: no prompt waits on a person, and an authority it
     * never recorded mounts nothing rather than the interactive default.
     */
    const unattended = config.data.kind === 'unattended_stream'
    const recordedSecretAuthority = parseRecordedSecretAuthority(saved.secretAuthority)
    const secretAuthority = unattended
      ? (recordedSecretAuthority ?? NO_SECRET_AUTHORITY)
      : recordedSecretAuthority
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
        copilotResourceAdmission:
          config.data.resourceAuthoringVersion === RESOURCE_AUTHORING_VERSION
            ? createCopilotResourceAdmission({ userId, invocation: { kind: 'chat', chatId } })
            : undefined,
        billingAttribution,
        userPermission: userPermission ?? undefined,
        interactive: !unattended,
        autoExecuteTools: true,
        clientToolPickupExpected: config.data.clientToolPickupExpected,
        ...(secretAuthority
          ? {
              secretMountPolicy: secretAuthority.secretMountPolicy,
              secretActorUserId: secretAuthority.secretActorUserId,
            }
          : {}),
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
}
