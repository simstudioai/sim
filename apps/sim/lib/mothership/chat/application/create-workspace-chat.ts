import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'
import { isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { selectedMemorySpaceForNewChat } from '@/lib/mothership/memory/spaces'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const createWorkspaceChat = defineAuthorizedWorkspaceUseCase({
  /** permission-group-exempt: creating an empty private chat preserves the existing workspace membership policy. */
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.create',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    capability: 'none',
  }),
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; mode?: 'agent' | 'assistant' | 'plan' }
  }) => resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, context, input }) {
    const userId = requirePrincipalSubjectUserId(principal)
    if (input.mode === 'plan' && !(await isPlanModeEnabled(userId)))
      throw new OrchestrationError('not_found', 'Plan mode is unavailable')
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId,
        workspaceId: context.workspaceId,
        type: 'mothership',
        config: { conversationMode: input.mode ?? 'agent' },
        memorySpaceId: await selectedMemorySpaceForNewChat(userId, context.workspaceOrganizationId),
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        lastSeenAt: new Date(),
      })
      .returning({ id: copilotChats.id })
    if (!chat) throw new Error('Failed to create workspace chat')
    return chat
  },
  afterSuccess({ context, result }) {
    publishChatStatusChanged(context, { chatId: result.id, type: 'created' })
  },
})
