import type { Principal } from '@sim/auth/principal'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { readChatAttachment } from '@/lib/mothership/chat/application/read-attachment'
import { readChatSandboxFile } from '@/lib/mothership/chat/application/read-sandbox-file'
import {
  inlineChatImageUrl,
  inlineImageRequestIdSchema,
  inlineImageSourceSchema,
  normalizeInlineFileReference,
} from '@/lib/mothership/chat/inline-image-reference'
import {
  loadInlineChatImage,
  normalizeInlineChatImage,
  storeInlineChatImage,
} from '@/lib/mothership/chat/inline-image-storage'
import { loadActiveWorkspaceFileContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'
import { prepareImageForVision } from '@/lib/workspace-files/prepare-image-for-vision'

interface InlineChatImageInput {
  chatId: string
  requestId: string
  reference: string
  signal?: AbortSignal
}
function validateImageInput(input: InlineChatImageInput) {
  if (
    !inlineImageRequestIdSchema.safeParse(input.requestId).success ||
    !inlineImageSourceSchema.safeParse(input.reference).success
  )
    throw new OrchestrationError('validation', 'Invalid chat image reference.')
}

/** Saved history remains readable after Copilot is disabled; current private ownership still applies. */
export const readInlineChatImage = defineAuthorizedChatUseCase({
  /** permission-group-exempt: viewing existing private chat history does not initiate Copilot work. */
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_image',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  /** permission-group-exempt: viewing existing private chat history does not initiate Copilot work. */
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.read_image',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  resolveContext({ principal, input }: { principal: Principal; input: InlineChatImageInput }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {},
  async execute({ context, input, request }) {
    validateImageInput(input)
    const buffer = await loadInlineChatImage(
      context.chatId,
      input.requestId,
      input.reference,
      input.signal ?? request?.signal
    )
    return { buffer, contentType: 'image/webp' as const }
  },
})

/** One authorized display operation snapshots a first-party reference without mutating its source. */
export const materializeInlineChatImage = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.publish_image',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session', 'personal_api_key', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.publish_image',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session', 'personal_api_key', 'organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  }),
  resolveContext({ principal, input }: { principal: Principal; input: InlineChatImageInput }) {
    return resolveOwnedChatContext(principal, input.chatId)
  },
  authorizationOptions: {
    delegation: {
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      isWithinScope: (principal, context) =>
        principal.resourceScope?.chatId === context.chatId &&
        principal.resourceScope?.fileId === undefined,
    },
  },
  async execute({ principal, context, input, request }) {
    validateImageInput(input)
    const signal = input.signal ?? request?.signal
    signal?.throwIfAborted()
    const url = inlineChatImageUrl(context.chatId, input.requestId, input.reference)
    try {
      await loadInlineChatImage(context.chatId, input.requestId, input.reference, signal)
      return { url }
    } catch (error) {
      if (!(error instanceof OrchestrationError) || error.code !== 'not_found') throw error
    }
    const reference = normalizeInlineFileReference(input.reference)
    const scope = {
      chatId: context.chatId,
      workspaceId: context.workspaceId,
      organizationId: context.organizationId,
      maxBytes: MAX_TEXT_EXTRACTION_BYTES,
    }
    let source: Buffer
    if (reference.startsWith('/')) {
      source = (
        await readChatSandboxFile.execute({
          principal,
          input: { ...scope, path: decodeURIComponent(reference), signal },
          request,
        })
      ).buffer
    } else if (context.organizationId && reference.startsWith('uploads/')) {
      source = (
        await readChatAttachment.execute({
          principal,
          input: { chatId: context.chatId, reference, signal },
          request,
        })
      ).buffer
    } else {
      let workspaceId = context.workspaceId
      let filePrincipal: Principal = principal
      if (context.organizationId) {
        const canonical = await loadActiveWorkspaceFileContext(reference)
        if (!canonical)
          throw new OrchestrationError(
            'not_found',
            'Use the canonical workspace file ID in organization chat image tags.'
          )
        await resolveInvocationWorkspace(
          {
            userId: context.userId,
            organizationId: context.organizationId,
            chatId: context.chatId,
          },
          canonical.workspaceId
        )
        workspaceId = canonical.workspaceId
        filePrincipal = createCopilotChatFilePrincipal({
          userId: context.userId,
          workspaceId,
          chatId: context.chatId,
        })
      }
      if (!workspaceId) throw new OrchestrationError('not_found', 'Workspace file not found')
      source = (
        await readWorkspaceFileArtifact.execute({
          principal: filePrincipal,
          input: { chatId: context.chatId, workspaceId, maxBytes: scope.maxBytes, reference },
          request,
        })
      ).buffer
    }
    signal?.throwIfAborted()
    const prepared = await prepareImageForVision(source, signal)
    const buffer = await normalizeInlineChatImage(prepared.buffer, signal)
    await storeInlineChatImage(context.chatId, input.requestId, input.reference, buffer, signal)
    return { url }
  },
})

/** Converts authenticated server ingestion identity into the existing chat-scoped file delegation. */
export function materializeStreamImage(
  context: { userId: string; chatId: string } & (
    | { workspaceId: string; organizationId?: never }
    | { organizationId: string; workspaceId?: never }
  ),
  input: { requestId: string; reference: string; signal?: AbortSignal }
) {
  return materializeInlineChatImage.execute({
    principal: context.organizationId
      ? createTrustedOrganizationCopilotPrincipal(
          {
            ...context,
            organizationId: context.organizationId,
            delegationId: `chat-image:${context.chatId}`,
          },
          {
            audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
            ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
          }
        )
      : createCopilotChatFilePrincipal({
          userId: context.userId,
          chatId: context.chatId,
          workspaceId: context.workspaceId!,
        }),
    input: { ...input, chatId: context.chatId },
  })
}
