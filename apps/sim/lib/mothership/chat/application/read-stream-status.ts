import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  requireOwnedChatReadable,
  resolveOwnedChatContext,
} from '@/lib/mothership/chat/application/context'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'

interface ReadChatStreamStatusInput {
  chatId: string
}

/**
 * The owner's chat's live stream id, reconciled against the stream lock exactly
 * as the chat detail read reports it, without loading the transcript.
 */
export const readChatStreamStatus = defineAuthorizedChatUseCase({
  // permission-group-exempt: reads whether the owner's own chat is still streaming and starts no turn
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_stream_status',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: reads whether the owner's own chat is still streaming and starts no turn. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_stream_status',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ReadChatStreamStatusInput
  }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context }) {
    await requireOwnedChatReadable(context)
    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, context.chatId),
          eq(copilotChats.userId, context.userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .limit(1)
    if (!chat) throw new OrchestrationError('not_found', 'Chat not found')
    const markers = await reconcileChatStreamMarkers(
      [{ chatId: context.chatId, streamId: chat.conversationId }],
      { repairVerifiedStaleMarkers: true }
    )
    return { activeStreamId: markers.get(context.chatId)?.streamId ?? null }
  },
})
