import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { copilotRuns } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { insertRunSegment, withRunAdmissionLock } from '@/lib/mothership/async-runs/repository'
import { moveChatToTurn } from '@/lib/mothership/chat/application/admit-turn'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedWorkspaceChatContext } from '@/lib/mothership/chat/application/context'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { buildPersistedUserMessage } from '@/lib/mothership/chat/persisted-message'
import { StreamRecoveryConfigSchema } from '@/lib/mothership/request/lifecycle/recovery-config'
import {
  assertChatStreamLease,
  type ChatStreamLease,
} from '@/lib/mothership/request/session/controller-lease'
import type { TurnSecretAuthority } from '@/lib/mothership/secret-mount-policy'

/** The delegation audience a scheduled job's turn is admitted under. */
export const UNATTENDED_TURN_AUDIENCE = 'sim:copilot-jobs'

interface AdmitUnattendedTurnInput {
  /** The turn's request is its identity: its message id names the run, its stream and its user message. */
  recovery: z.input<typeof StreamRecoveryConfigSchema>
  lease: ChatStreamLease
  secretAuthority: TurnSecretAuthority
}

type UnattendedAdmission =
  | { kind: 'admitted'; run: Awaited<ReturnType<typeof insertRunSegment>> }
  | { kind: 'duplicate' }

/**
 * Admits a turn nobody is watching (a scheduled job's occurrence) as a durable chat turn: the
 * user message, the run and its recovery intent commit together under the chat lock its
 * controller holds, exactly as a typed send's admission does, so Sim's takeover can drive it
 * on after this process dies. The message id is the idempotency key: a second admission of
 * the same occurrence finds its run and admits nothing.
 */
export const admitUnattendedTurn = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.admit_unattended_turn',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    contentDelivery: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.admit_unattended_turn',
    contentDelivery: 'none',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegationAudience: UNATTENDED_TURN_AUDIENCE,
    delegatedServices: ['copilot'],
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
    input: AdmitUnattendedTurnInput
  }) => resolveOwnedWorkspaceChatContext(principal, input.recovery.request.chatId),
  authorizationOptions: {
    delegation: {
      audience: UNATTENDED_TURN_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.serviceId === 'copilot' &&
        principal.workspaceId === context.workspaceId &&
        principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ context, input }): Promise<UnattendedAdmission> {
    const { userId, workspaceId, chatId } = context
    const recovery = StreamRecoveryConfigSchema.parse(input.recovery)
    const request = recovery.request
    if (
      recovery.kind !== 'unattended_stream' ||
      !request.origin ||
      request.userId !== userId ||
      request.workspaceId !== workspaceId ||
      request.organizationId !== undefined ||
      request.chatId !== chatId
    ) {
      throw new OrchestrationError('validation', 'Turn identity does not match its chat')
    }
    const { messageId, message, origin } = request
    await assertChatStreamLease(input.lease)
    return withRunAdmissionLock(userId, messageId, async (tx) => {
      const [existing] = await tx
        .select({ id: copilotRuns.id })
        .from(copilotRuns)
        .where(eq(copilotRuns.streamId, messageId))
        .limit(1)
      if (existing) return { kind: 'duplicate' } as const
      const chat = await moveChatToTurn(tx, context, request)
      await appendCopilotChatMessages(
        chatId,
        [
          buildPersistedUserMessage({
            id: messageId,
            content: message,
            origin,
            requestMode: 'agent',
          }),
        ],
        { streamId: messageId, chatModel: chat.model },
        tx
      )
      const run = await insertRunSegment(tx, {
        id: messageId,
        executionId: messageId,
        chatId,
        userId,
        workspaceId,
        streamId: messageId,
        requestContext: {
          requestId: messageId,
          controllerToken: input.lease.value,
          recovery,
          secretAuthority: input.secretAuthority,
        },
      })
      return { kind: 'admitted', run } as const
    })
  },
})
