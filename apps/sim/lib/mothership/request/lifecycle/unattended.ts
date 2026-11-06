/**
 * Durable turns nobody is watching. A scheduled job's occurrence runs as a chat turn on the same
 * leased path a typed send takes: a controller holds the chat lock, the run records its recovery
 * intent and billing admission, and Sim's abandoned-run takeover re-drives it after the process
 * driving it dies (a deploy or a crash). The headless lifecycle the wake door uses has none of
 * that: its run carries no controller, so nothing can continue it once its process is gone.
 */
import type {
  AttributedBillingRequestEnvelope,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/attribution'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import {
  createCopilotResourceAdmission,
  createTrustedCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  admitUnattendedTurn,
  UNATTENDED_TURN_AUDIENCE,
} from '@/lib/mothership/chat/application/admit-unattended-turn'
import { buildOnComplete, buildOnError } from '@/lib/mothership/chat/completion'
import { PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import {
  durableResourceAuthoringVersion,
  StreamRecoveryConfigSchema,
} from '@/lib/mothership/request/lifecycle/recovery-config'
import { createSSEStream } from '@/lib/mothership/request/lifecycle/start'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import type { TurnSecretAuthority } from '@/lib/mothership/secret-mount-policy'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const DELEGATION_TTL_MS = 60_000

export interface UnattendedTurnInput {
  userId: string
  workspaceId: string
  chatId: string
  /** The turn's id: its run, its stream and its user message. Retrying with it never starts a second turn. */
  messageId: string
  message: string
  origin: 'job'
  /** Who pays for the turn, resolved by the caller (which already needed it to check the limit). */
  billingAttribution: BillingAttributionSnapshot
  /** Which secrets the turn's code may mount; recorded so a recovered leg mounts the same. */
  secretAuthority: TurnSecretAuthority
  /** Called once the turn's first leg is admitted for billing, with the request its charges settle under. */
  onBillingAdmission?: (admission: AttributedBillingRequestEnvelope) => Promise<void>
}

/**
 * `started`: this call admitted the turn and its controller is running it. `duplicate`: a turn
 * with this id was already admitted (by an earlier attempt). `busy`: another turn holds the chat.
 */
export type UnattendedTurnStart = 'started' | 'duplicate' | 'busy'

/**
 * Admits and starts an unattended turn, detached from any HTTP response. The admission commits
 * before the controller starts, so a process that dies right after leaves a recoverable run, not
 * a lost one.
 */
export async function startUnattendedTurn(
  input: UnattendedTurnInput
): Promise<UnattendedTurnStart> {
  const { userId, workspaceId, chatId, messageId } = input
  const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!(await acquirePendingChatStream(chatId, messageId, 0))) {
    /** The holder may be this very turn, still being admitted by another attempt. */
    const holder = await getPendingChatStreamId(chatId)
    return holder === messageId || (await getLatestRunForStream(messageId, userId))
      ? 'duplicate'
      : 'busy'
  }
  const lease = getLocalChatStreamLease(chatId, messageId)
  try {
    if (!lease) throw new Error('An unattended turn needs its chat lease')
    const principal = createTrustedCopilotPrincipal(
      { userId, workspaceId, chatId, delegationId: `${input.origin}:${messageId}` },
      { audience: UNATTENDED_TURN_AUDIENCE, ttlMs: DELEGATION_TTL_MS }
    )
    const request = {
      message: input.message,
      userId,
      protocolVersion: PROTOCOL_VERSION,
      mode: 'agent' as const,
      workspaceId,
      chatId,
      messageId,
      origin: input.origin,
    }
    const copilotResourceAdmission = createCopilotResourceAdmission({
      userId,
      invocation: { kind: 'chat', chatId },
    })
    const recovery = StreamRecoveryConfigSchema.parse({
      kind: 'unattended_stream',
      request,
      goRoute: '/api/mothership',
      clientToolPickupExpected: false,
      requestMode: 'agent',
      resourceAuthoringVersion: durableResourceAuthoringVersion(true),
    })
    const executionId = messageId
    const requestId = messageId
    const admission = await admitUnattendedTurn.execute({
      principal,
      input: { recovery, lease, secretAuthority: input.secretAuthority },
    })
    if (admission.kind === 'duplicate') {
      await releasePendingChatStream(chatId, messageId, lease)
      return 'duplicate'
    }
    const completion = {
      chatId,
      userMessageId: messageId,
      requestId,
      workspaceId,
      userId,
      requestMode: 'agent' as const,
      notifyWorkspaceStatus: true,
      runController: { id: admission.run.id, token: lease.value },
    }
    const stream = createSSEStream({
      requestPayload: request,
      admittedRun: admission.run,
      userId,
      streamId: messageId,
      executionId,
      runId: admission.run.id,
      chatId,
      currentChat: null,
      message: input.message,
      titleModel: '',
      requestId,
      workspaceId,
      orchestrateOptions: {
        userId,
        workspaceId,
        chatId,
        executionId,
        runId: admission.run.id,
        goRoute: '/api/mothership',
        copilotResourceAdmission,
        billingAttribution: input.billingAttribution,
        ...(userPermission ? { userPermission } : {}),
        interactive: false,
        autoExecuteTools: true,
        clientToolPickupExpected: false,
        secretMountPolicy: input.secretAuthority.secretMountPolicy,
        secretActorUserId: input.secretAuthority.secretActorUserId,
        ...(input.onBillingAdmission ? { onBillingAdmission: input.onBillingAdmission } : {}),
        onComplete: buildOnComplete(completion),
        onError: buildOnError(completion),
      },
    })
    // Nobody reads it: the lifecycle runs detached, as a typed turn does after its tab closes.
    void stream.cancel().catch(() => {})
    return 'started'
  } catch (error) {
    await releasePendingChatStream(chatId, messageId, lease)
    throw error
  }
}
