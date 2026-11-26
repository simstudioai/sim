import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotFeedback } from '@sim/db/schema'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'

interface SubmitChatFeedbackInput {
  chatId: string
  userQuery: string
  agentResponse: string
  isPositive: boolean
  feedback?: string
  workflowYaml?: string
}

/**
 * Records the owner's rating of an assistant reply. A chat the caller does not own resolves to
 * not found, the same as an unknown id, so feedback never attaches to someone else's chat.
 */
export const submitChatFeedback = defineAuthorizedChatUseCase({
  // permission-group-exempt: rating a reply in the caller's own chat starts no turn and reads nothing new
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.submit_feedback',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: rating a reply in the caller's own chat starts no turn and reads nothing new. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.submit_feedback',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: SubmitChatFeedbackInput
  }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    const [{ feedbackId }] = await db
      .insert(copilotFeedback)
      .values({
        userId: context.userId,
        chatId: context.chatId,
        userQuery: input.userQuery,
        agentResponse: input.agentResponse,
        isPositive: input.isPositive,
        feedback: input.feedback || null,
        workflowYaml: input.workflowYaml || null,
      })
      .returning({ feedbackId: copilotFeedback.feedbackId })
    return { feedbackId }
  },
})
