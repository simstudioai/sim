import type { SessionPrincipal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
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
export const changeChatResources = defineAuthorizedChatUseCase({
  // permission-group-exempt: organizing saved panels changes only the owned chat metadata and grants no access to resource contents
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.change_resources',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: organizing owned chat metadata grants no access to resource contents. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.change_resources',
    minimumRole: 'member',
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
