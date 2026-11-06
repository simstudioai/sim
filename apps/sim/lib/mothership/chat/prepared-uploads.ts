import { createLogger } from '@sim/logger'
import { isPermissionType, permissionSatisfies } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { buildUploadedFileContext } from '@/lib/mothership/chat/upload-context'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/file-manager'

const logger = createLogger('ChatUploadContexts')

interface ChatUploadContext {
  type: string
  content: string
  tag?: string
  path?: string
}

/**
 * The context tags a message's attached files become in the model's input,
 * shared by a turn and by steering so a file reaches the model the same way
 * either way.
 *
 * In a workspace chat each file is tracked as a chat upload (a `workspace_files`
 * row), which needs the same write grant the upload routes that issue these keys
 * require; reaching the chat with `read` must not confer a file-write capability.
 * An organization chat names each file by its id. Assistant mode carries none.
 */
export async function buildChatUploadContexts(params: {
  isAssistant: boolean
  userId: string
  chatId?: string
  workspaceId?: string
  organizationId?: string
  userPermission?: string
  userMessageId: string
  fileAttachments?: ReadonlyArray<{
    id: string
    key: string
    size: number
    filename?: unknown
    name?: unknown
    media_type?: unknown
    mimeType?: unknown
  }>
}): Promise<ChatUploadContext[]> {
  const { isAssistant, userId, chatId, workspaceId, fileAttachments, userMessageId } = params
  const uploadContexts: ChatUploadContext[] = []
  // `userPermission` is typed `string` for legacy reasons, so narrow it before
  // comparing — an unrecognized value must fail the gate, not rank below it.
  const canWriteWorkspaceFiles =
    isPermissionType(params.userPermission) && permissionSatisfies(params.userPermission, 'write')
  if (!isAssistant && chatId && workspaceId && fileAttachments && fileAttachments.length > 0) {
    if (!canWriteWorkspaceFiles) {
      logger.warn('Dropping chat file attachments without workspace write access', {
        chatId,
        workspaceId,
        attachmentCount: fileAttachments.length,
      })
    }
    const trackableAttachments = canWriteWorkspaceFiles ? fileAttachments : []
    for (const f of trackableAttachments) {
      const filename = (f.filename ?? f.name ?? 'file') as string
      const mediaType = (f.media_type ?? f.mimeType ?? 'application/octet-stream') as string
      try {
        const { displayName } = await trackChatUpload(
          workspaceId,
          userId,
          chatId,
          f.key,
          filename,
          mediaType,
          f.size,
          userMessageId
        )
        uploadContexts.push(buildUploadedFileContext(displayName, mediaType, f.size))
      } catch (err) {
        const cause = toError(err)
        logger.warn('Failed to track chat upload', {
          filename,
          chatId,
          error: cause.message,
        })
        // Isolate failures by entry. Aborting here discarded every valid
        // sibling attachment in the request, even ones already tracked. Give
        // the model a local marker for this file and continue preparing the
        // rest of the batch.
        uploadContexts.push({
          type: 'uploaded_file',
          content: `File "${filename}" could not be prepared for Copilot and was omitted. Other attached files remain available.`,
        })
      }
    }
  }

  if (params.organizationId && !isAssistant) {
    for (const attachment of fileAttachments ?? []) {
      uploadContexts.push(
        buildUploadedFileContext(
          typeof attachment.filename === 'string' ? attachment.filename : attachment.id,
          typeof attachment.media_type === 'string'
            ? attachment.media_type
            : 'application/octet-stream',
          attachment.size,
          attachment.id
        )
      )
    }
  }
  return uploadContexts
}
