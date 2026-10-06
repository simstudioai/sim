import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { withChatEffortChoice } from '@/lib/mothership/chat/intent'
import type { MothershipEffort } from '@/lib/mothership/model-options'

interface SetChatEffortInput {
  chatId: string
  effort: MothershipEffort
}

/** Records the effort the owner picked for a chat, so its later turns keep it. */
export const setChatEffort = defineAuthorizedChatUseCase({
  // permission-group-exempt: a chat's reasoning effort is owned chat metadata and starts no turn
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.set_effort',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: a chat's reasoning effort is owned chat metadata and starts no turn. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.set_effort',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({ principal, input }: { principal: SessionPrincipal; input: SetChatEffortInput }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    const [chat] = await db
      .update(copilotChats)
      .set({
        config: withChatEffortChoice(
          sql`COALESCE(${copilotChats.config}, '{}'::jsonb)`,
          input.effort
        ),
      })
      .where(
        and(
          eq(copilotChats.id, context.chatId),
          eq(copilotChats.userId, context.userId),
          isNull(copilotChats.deletedAt)
        )
      )
      .returning({ id: copilotChats.id })
    if (!chat) throw new OrchestrationError('not_found', 'Chat not found')
    return {}
  },
})
