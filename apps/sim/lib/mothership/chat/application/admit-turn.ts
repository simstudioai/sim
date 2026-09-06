import type { SessionPrincipal } from '@sim/auth/principal'
import { copilotChats, idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { insertRunSegment, withRunAdmissionLock } from '@/lib/mothership/async-runs/repository'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  type UserMessageParams,
} from '@/lib/mothership/chat/persisted-message'
import { chatPubSub } from '@/lib/mothership/chat-status'
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
}

/** The accepted message, its start intent and retry destination commit together. */
export const admitChatTurn = defineAuthorizedWorkspaceUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.admit_turn',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  resolveContext({ principal, input }: { principal: SessionPrincipal; input: AdmitTurnInput }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    const { userId, workspaceId, chatId } = context
    const recovery = StreamRecoveryConfigSchema.parse(input.recovery)
    const request = recovery.request
    if (
      request.userId !== userId ||
      request.workspaceId !== workspaceId ||
      request.chatId !== chatId ||
      request.messageId !== input.message.id ||
      request.message !== input.message.content
    ) {
      throw new OrchestrationError('validation', 'Turn identity does not match its chat')
    }
    await assertChatStreamLease(input.lease)
    return withRunAdmissionLock(userId, request.messageId, async (tx) => {
      const [chat] = await tx
        .update(copilotChats)
        .set({ conversationId: request.messageId, updatedAt: new Date() })
        .where(
          and(
            eq(copilotChats.id, chatId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.workspaceId, workspaceId),
            isNull(copilotChats.deletedAt)
          )
        )
        .returning({ model: copilotChats.model })
      if (!chat) throw new OrchestrationError('not_found', 'Chat not found')
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
        streamId: request.messageId,
        workflowId: request.workflowId,
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
      if (!claim)
        throw new OrchestrationError('conflict', 'This send was superseded; retry the message')
      return run
    })
  },
  async afterSuccess({ context, input }) {
    if (!input.notifyWorkspaceStatus) return
    try {
      await chatPubSub?.publishStatusChanged({
        workspaceId: context.workspaceId,
        chatId: context.chatId,
        type: 'started',
        streamId: input.message.id,
      })
    } catch (error) {
      createLogger('ChatAdmission').warn('Could not publish admitted chat status', {
        error: getErrorMessage(error),
      })
    }
  },
})
