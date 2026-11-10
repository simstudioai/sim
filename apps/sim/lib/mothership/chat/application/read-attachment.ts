import type { Principal } from '@sim/auth/principal'
import { defineWorkspaceOperation, requireAdmittedContent } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { EXACT_EMPTY_DURABLE_SECRET_PROVENANCE } from '@/lib/execution/durable-secret-provenance'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { loadChatFileAttachmentsNamed } from '@/lib/mothership/chat/lifecycle'
import { readOrganizationChatAttachment } from '@/lib/uploads/contexts/organization-assistant/application'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

/** The chat holds no attachment by the name an `uploads/` reference gives. */
class ChatAttachmentMissingError extends OrchestrationError {
  constructor() {
    super('not_found', 'Chat attachment not found')
  }
}

/**
 * Org uploads are private chat attachments, never files in an arbitrary workspace. A chat that
 * moved out of a retired personal organization into its owner's workspace keeps reading the ones
 * it names, now held by that workspace.
 */
export const readChatAttachment = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_attachment',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    contentDelivery: 'sourced',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_attachment',
    contentDelivery: 'sourced',
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
    if (!input.reference.startsWith('uploads/')) throw new ChatAttachmentMissingError()
    let name: string
    try {
      name = decodeURIComponent(input.reference.slice('uploads/'.length))
    } catch {
      throw new OrchestrationError('validation', 'Invalid attachment reference')
    }
    const attachments = await loadChatFileAttachmentsNamed(context.chatId, name)
    const matches = new Map(attachments.map((file) => [file.id, file] as const))
    if (!matches.size) throw new ChatAttachmentMissingError()
    if (matches.size > 1)
      throw new OrchestrationError(
        'not_found',
        'Several attachments have this name. Use uploads/<attachment-id>.'
      )
    const file = matches.values().next().value
    if (!file) throw new OrchestrationError('not_found', 'Chat attachment not found')
    /** A member's own upload to this chat carries no secret Sim resolved into it. */
    await requireAdmittedContent(principal, {
      kind: 'workspace-file',
      id: file.id,
      provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
      view: 'complete',
    })
    return readOrganizationChatAttachment({
      principal,
      ...(context.organizationId
        ? { organizationId: context.organizationId }
        : { workspaceId: context.workspaceId }),
      key: file.key,
      maxBytes: input.maxBytes,
      signal: input.signal,
    })
  },
})

type ChatAttachmentRead = Parameters<typeof readChatAttachment.execute>[0]
type ChatAttachment = Awaited<ReturnType<typeof readChatAttachment.execute>>

/**
 * A workspace chat's file reference, read from its workspace and, when no workspace file answers an
 * `uploads/` reference, from the chat's own attachments: an organization chat moved to its owner's
 * workspace keeps the attachments it was sent, which live outside the workspace's files. Keyed on
 * what the chat holds, never on its scope. A chat with no attachment by that name keeps the
 * workspace's refusal. `chatRead` is null for a chat with no attachments to try.
 */
export async function readWorkspaceFileOrChatUpload<T>(
  readWorkspaceFile: () => Promise<T>,
  chatRead: ChatAttachmentRead | null
): Promise<{ file: T; attachment?: never } | { attachment: ChatAttachment; file?: never }> {
  try {
    return { file: await readWorkspaceFile() }
  } catch (error) {
    if (
      !chatRead?.input.reference.startsWith('uploads/') ||
      !(error instanceof OrchestrationError) ||
      error.code !== 'not_found'
    )
      throw error
    try {
      return { attachment: await readChatAttachment.execute(chatRead) }
    } catch (attachmentError) {
      if (attachmentError instanceof ChatAttachmentMissingError) throw error
      throw attachmentError
    }
  }
}
