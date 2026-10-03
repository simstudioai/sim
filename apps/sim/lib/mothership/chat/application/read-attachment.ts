import type { Principal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { readOrganizationChatAttachment } from '@/lib/uploads/contexts/organization-assistant/application'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

/** Org uploads are private chat attachments, never files in an arbitrary workspace. */
export const readChatAttachment = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_attachment',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_attachment',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session', 'organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  }),
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: {
      chatId: string
      reference: string
      maxBytes?: number
      signal?: AbortSignal
    }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: {
    delegation: {
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      isWithinScope: (principal, context) => principal.resourceScope?.chatId === context.chatId,
    },
  },
  async execute({ principal, context, input }) {
    if (!context.organizationId || !input.reference.startsWith('uploads/'))
      throw new OrchestrationError('not_found', 'Chat attachment not found')
    let name: string
    try {
      name = decodeURIComponent(input.reference.slice('uploads/'.length))
    } catch {
      throw new OrchestrationError('validation', 'Invalid attachment reference')
    }
    const messages = await loadCopilotChatMessages(context.chatId)
    const matches = new Map(
      messages.flatMap((message) =>
        (message.fileAttachments ?? [])
          .filter((file) => file.id === name || file.filename === name)
          .map((file) => [file.id, file] as const)
      )
    )
    if (matches.size !== 1)
      throw new OrchestrationError(
        'not_found',
        matches.size
          ? 'Several attachments have this name. Use uploads/<attachment-id>.'
          : 'Chat attachment not found'
      )
    const file = matches.values().next().value
    if (!file) throw new OrchestrationError('not_found', 'Chat attachment not found')
    return readOrganizationChatAttachment({
      principal,
      organizationId: context.organizationId,
      key: file.key,
      maxBytes: input.maxBytes,
      signal: input.signal,
    })
  },
})
