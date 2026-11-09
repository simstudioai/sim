import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { CopilotChatSteerInput } from '@/lib/api/contracts/copilot'
import { prepareOrganizationChatAttachments } from '@/lib/mothership/chat/assistant-images'
import { normalizeContexts } from '@/lib/mothership/chat/normalize-contexts'
import type { PersistedFileAttachment } from '@/lib/mothership/chat/persisted-message'
import { buildChatUploadContexts } from '@/lib/mothership/chat/prepared-uploads'
import { processContextsServer } from '@/lib/mothership/chat/process-contents'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import type { ChatContextItem, SteerV2Request } from '@/lib/mothership/generated/protocol'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { ChatContext } from '@/stores/panel'

const logger = createLogger('MothershipSteeringInput')

interface SteeringChat {
  userId: string
  chatId: string
  workspaceId?: string
  organizationId?: string
  mode?: string
}

/** What a steering message carries to the worker, rendered as a turn renders its own. */
export interface PreparedSteeringInput {
  context: ChatContextItem[]
  assistantImages?: SteerV2Request['assistantImages']
  /** The files as the transcript shows them; an organization chat's images resolve to private copies. */
  fileAttachments?: PersistedFileAttachment[]
}

/**
 * Renders a steering message's mentions and files the way a turn renders its own,
 * so a message steers with the same context it would carry as a turn: mentions
 * through `processContextsServer` (which enforces the turn's context cap), files
 * as tracked uploads in a workspace chat, and in an organization chat as images
 * the run may read. A mention that fails to resolve is dropped, as it is for a turn.
 */
export async function prepareSteeringInput(params: {
  principal: SessionPrincipal
  chat: SteeringChat
  input: Pick<CopilotChatSteerInput, 'steeringId' | 'content' | 'contexts' | 'fileAttachments'>
}): Promise<PreparedSteeringInput> {
  const { principal, chat, input } = params
  const { userId, chatId, workspaceId, organizationId } = chat
  const mode = chat.mode === 'assistant' ? 'assistant' : chat.mode === 'plan' ? 'plan' : 'agent'
  const isAssistant = mode === 'assistant'
  const contexts = normalizeContexts(input.contexts) ?? []

  const images =
    organizationId && input.fileAttachments?.length
      ? await prepareOrganizationChatAttachments({
          principal,
          organizationId,
          mode,
          attachments: input.fileAttachments,
        })
      : undefined
  const fileAttachments = images?.attachments ?? input.fileAttachments

  let mentionContexts: ChatContextItem[] = []
  if (contexts.length > 0) {
    try {
      const { resolvedSecretTraceRegistry } = await prepareCopilotEnvironmentContext(
        userId,
        workspaceId,
        { includeSecrets: !isAssistant && !organizationId }
      )
      mentionContexts = isAssistant
        ? (await processContextsServer(contexts as ChatContext[], userId, input.content)).filter(
            (context) => context.type === 'browser_page'
          )
        : await processContextsServer(
            contexts as ChatContext[],
            userId,
            input.content,
            workspaceId,
            chatId,
            resolvedSecretTraceRegistry,
            organizationId,
            mode
          )
    } catch (error) {
      logger.error('Failed to process steering contexts', {
        chatId,
        steeringId: input.steeringId,
        error: toError(error).message,
      })
    }
  }

  const userPermission =
    workspaceId && fileAttachments?.length
      ? ((await getUserEntityPermissions(userId, 'workspace', workspaceId)) ?? undefined)
      : undefined
  const uploadContexts = await buildChatUploadContexts({
    isAssistant,
    userId,
    chatId,
    workspaceId,
    organizationId,
    userPermission,
    userMessageId: input.steeringId,
    fileAttachments,
  })

  return {
    context: [...mentionContexts, ...uploadContexts],
    ...(images?.content.length ? { assistantImages: images.content } : {}),
    ...(fileAttachments?.length
      ? {
          fileAttachments: fileAttachments.map((file) => ({
            id: file.id,
            key: file.key,
            filename: file.filename,
            media_type: file.media_type,
            size: file.size,
          })),
        }
      : {}),
  }
}
