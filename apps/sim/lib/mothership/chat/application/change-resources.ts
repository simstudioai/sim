import type { SessionPrincipal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import {
  type ChatResourceChange,
  changeStoredChatResources,
} from '@/lib/mothership/resources/store'

interface ChangeChatResourcesInput {
  chatId: string
  change: ChatResourceChange
}

/** Resource tabs belong to the acting chat owner and require current workspace access. */
export const changeChatResources = defineAuthorizedWorkspaceUseCase({
  // permission-group-exempt: organizing saved panels changes only the owned chat metadata and grants no access to resource contents
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.change_resources',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ChangeChatResourcesInput
  }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    return { resources: await changeStoredChatResources(context.chatId, input.change) }
  },
})
