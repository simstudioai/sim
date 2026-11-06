import type { SessionPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import {
  requireOwnedChatReadable,
  resolveOwnedChatContext,
} from '@/lib/mothership/chat/application/context'
import { loadCopilotChatMessagesBefore } from '@/lib/mothership/chat/lifecycle'
import { compactToolCallParams, normalizeMessage } from '@/lib/mothership/chat/persisted-message'
import { decodeTranscriptCursor } from '@/lib/mothership/chat/transcript-cursor'

interface ReadChatOlderMessagesInput {
  chatId: string
  before: string
}

/**
 * A page of the owner's chat transcript before a cursor the chat detail read
 * issued, normalized and compacted exactly as that read returns its messages, so a message
 * the backfill has not reached still arrives without its bulk tool-call params.
 */
export const readChatOlderMessages = defineAuthorizedChatUseCase({
  // permission-group-exempt: reads the owner's own chat transcript and starts no turn
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_older_messages',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: reads the owner's own chat transcript and starts no turn. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_older_messages',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ReadChatOlderMessagesInput
  }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    const position = decodeTranscriptCursor(input.before)
    if (!position) throw new OrchestrationError('validation', 'Invalid cursor')
    await requireOwnedChatReadable(context)
    const page = await loadCopilotChatMessagesBefore(context.chatId, position)
    return {
      messages: page.messages.map((message) =>
        compactToolCallParams(normalizeMessage({ ...message }))
      ),
      olderCursor: page.olderCursor,
    }
  },
})
