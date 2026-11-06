import type { SessionPrincipal } from '@sim/auth/principal'
import { copilotChats, idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { resolveTurnDesktopDevice } from '@/lib/desktop/application/executor'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { insertRunSegment, withRunAdmissionLock } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { ChatSendSupersededError } from '@/lib/mothership/chat/application/send-superseded'
import { withChatEffortChoice } from '@/lib/mothership/chat/intent'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { authorizeOrganizationChat } from '@/lib/mothership/chat/organization-chats'
import {
  buildPersistedUserMessage,
  type UserMessageParams,
} from '@/lib/mothership/chat/persisted-message'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import type { MothershipEffort } from '@/lib/mothership/model-options'
import { StreamRecoveryConfigSchema } from '@/lib/mothership/request/lifecycle/recovery-config'
import {
  assertChatStreamLease,
  type ChatStreamLease,
} from '@/lib/mothership/request/session/controller-lease'

interface AdmitTurnInput {
  chatId: string
  runId: string
  executionId: string
  requestId: string
  message: UserMessageParams
  recovery: z.input<typeof StreamRecoveryConfigSchema>
  lease: ChatStreamLease
  sendClaim: { normalizedKey: string; claimToken: string }
  notifyWorkspaceStatus: boolean
  /** The effort this send picked, kept as the chat's choice for later turns. */
  effortChoice?: MothershipEffort
  /** The composer's desktop, offered for its background executor to run this turn's desktop tools. */
  desktopDeviceId?: string
}

/**
 * The desktop a turn runs on, if any. Only a workspace chat runs on a desktop in the background:
 * its sidebar shows the status and an approval notification links back to it. An organization
 * chat stays with its chat view.
 */
export async function turnDesktopDevice(
  principal: SessionPrincipal,
  workspaceId: string | null | undefined,
  offeredDeviceId: string | undefined
): Promise<string | null> {
  if (!offeredDeviceId || !workspaceId) return null
  return resolveTurnDesktopDevice(principal, offeredDeviceId)
}

interface TurnChat {
  userId: string
  workspaceId?: string | null
  organizationId?: string | null
  chatId: string
}

/**
 * Makes an admitted turn its chat's current conversation, inside the admission's transaction:
 * the chat's conversation mode follows the turn's, and a send's effort pick stays as the chat's
 * choice. A chat deleted or moved since its context was resolved is `not_found`.
 */
export async function moveChatToTurn(
  tx: DbTransaction,
  chat: TurnChat,
  turn: { messageId: string; mode?: string },
  effortChoice?: MothershipEffort
): Promise<{ model: string | null }> {
  const turnConfig = sql`COALESCE(${copilotChats.config}, '{}'::jsonb) || jsonb_build_object('conversationMode', ${turn.mode ?? 'agent'}::text)`
  const [updated] = await tx
    .update(copilotChats)
    .set({
      conversationId: turn.messageId,
      updatedAt: new Date(),
      config: effortChoice ? withChatEffortChoice(turnConfig, effortChoice) : turnConfig,
    })
    .where(
      and(
        eq(copilotChats.id, chat.chatId),
        eq(copilotChats.userId, chat.userId),
        chat.workspaceId
          ? eq(copilotChats.workspaceId, chat.workspaceId)
          : isNull(copilotChats.workspaceId),
        chat.organizationId
          ? eq(copilotChats.organizationId, chat.organizationId)
          : isNull(copilotChats.organizationId),
        isNull(copilotChats.deletedAt)
      )
    )
    .returning({ model: copilotChats.model })
  if (!updated) throw new OrchestrationError('not_found', 'Chat not found')
  return updated
}

/** The accepted message, its start intent and retry destination commit together. */
export const admitChatTurn = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.admit_turn',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.admit_turn',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  resolveContext({ principal, input }: { principal: SessionPrincipal; input: AdmitTurnInput }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ principal, context, input }) {
    const { userId, workspaceId, organizationId, chatId } = context
    const recovery = StreamRecoveryConfigSchema.parse(input.recovery)
    const request = recovery.request
    if (
      request.userId !== userId ||
      request.workspaceId !== workspaceId ||
      request.organizationId !== organizationId ||
      (input.message.requestMode ?? 'agent') !== (request.mode ?? 'agent') ||
      request.chatId !== chatId ||
      request.messageId !== input.message.id ||
      request.message !== input.message.content
    ) {
      throw new OrchestrationError('validation', 'Turn identity does not match its chat')
    }
    if (organizationId) {
      if (request.mode === 'agent' || request.mode === 'plan')
        await authorizeOrganizationChat.execute({
          principal,
          input: { organizationId, mode: request.mode },
        })
      else await requireOrganizationSearchAvailable(organizationId)
    }
    await assertChatStreamLease(input.lease)
    const desktopDeviceId = await turnDesktopDevice(principal, workspaceId, input.desktopDeviceId)
    return withRunAdmissionLock(userId, request.messageId, async (tx) => {
      const chat = await moveChatToTurn(tx, context, request, input.effortChoice)
      await appendCopilotChatMessages(
        chatId,
        [buildPersistedUserMessage(input.message)],
        { streamId: request.messageId, chatModel: chat.model },
        tx
      )
      const run = await insertRunSegment(tx, {
        id: input.runId,
        executionId: input.executionId,
        chatId,
        userId,
        workspaceId,
        organizationId,
        streamId: request.messageId,
        workflowId: request.workflowId,
        desktopDeviceId,
        requestContext: {
          requestId: input.requestId,
          controllerToken: input.lease.value,
          recovery,
        },
      })
      const [claim] = await tx
        .update(idempotencyKey)
        .set({
          result: {
            success: true,
            status: 'completed',
            result: { chatId },
            claimToken: input.sendClaim.claimToken,
          },
          createdAt: new Date(),
        })
        .where(
          and(
            eq(idempotencyKey.key, input.sendClaim.normalizedKey),
            sql`${idempotencyKey.result} ->> 'claimToken' = ${input.sendClaim.claimToken}`
          )
        )
        .returning({ key: idempotencyKey.key })
      if (!claim) throw new ChatSendSupersededError()
      return run
    })
  },
  async afterSuccess({ context, input }) {
    if (!input.notifyWorkspaceStatus) return
    try {
      publishChatStatusChanged(
        {
          workspaceId: context.workspaceId,
          organizationId: context.organizationId,
          userId: context.userId,
        },
        {
          chatId: context.chatId,
          type: 'started',
          streamId: input.message.id,
        }
      )
    } catch (error) {
      createLogger('ChatAdmission').warn('Could not publish admitted chat status', {
        error: getErrorMessage(error),
      })
    }
  },
})
