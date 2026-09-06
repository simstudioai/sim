import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { PersistedFileAttachment } from '@/lib/mothership/chat/persisted-message'
import { buildUploadedFileContext } from '@/lib/mothership/chat/upload-context'
import type { ChatContextItem } from '@/lib/mothership/generated/protocol'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import type { AgentMailAttachment } from '@/lib/mothership/inbox/types'
import {
  generateWorkspaceFileKey,
  trackChatUpload,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { deleteFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('InboxAttachments')

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

interface PreparedInboxAttachments {
  storedAttachments: PersistedFileAttachment[]
  context: ChatContextItem[]
}

/**
 * Server-owned ingestion binds incoming bytes to this chat before giving the model
 * a readable path. Each failed attachment leaves an explicit marker for that file.
 */
export async function prepareInboxAttachments({
  attachments,
  inboxProviderId,
  messageId,
  taskId,
  userId,
  workspaceId,
  chatId,
  userMessageId,
}: {
  attachments: AgentMailAttachment[]
  inboxProviderId: string | null
  messageId: string | null
  taskId: string
  userId: string
  workspaceId: string
  chatId: string
  userMessageId: string
}): Promise<PreparedInboxAttachments> {
  if (!inboxProviderId || !messageId || attachments.length === 0) {
    return { context: [], storedAttachments: [] }
  }

  const settled = await Promise.allSettled(
    attachments.map(async (attachment) => {
      if (attachment.size > MAX_ATTACHMENT_SIZE)
        throw new Error('Attachment exceeds the inbox size limit')
      const arrayBuffer = await agentmail.getAttachment(
        inboxProviderId,
        messageId,
        attachment.attachment_id
      )
      const buffer = Buffer.from(arrayBuffer)
      if (buffer.length > MAX_ATTACHMENT_SIZE)
        throw new Error('Attachment exceeds the inbox size limit')
      const storageKey = generateWorkspaceFileKey(workspaceId, attachment.filename)
      try {
        const uploaded = await uploadFile({
          file: buffer,
          fileName: attachment.filename,
          contentType: attachment.content_type,
          context: 'mothership',
          customKey: storageKey,
          preserveKey: true,
          metadata: { userId, workspaceId, originalName: attachment.filename },
        })
        const { displayName } = await trackChatUpload(
          workspaceId,
          userId,
          chatId,
          uploaded.key,
          attachment.filename,
          attachment.content_type,
          buffer.length,
          userMessageId
        )

        const stored: PersistedFileAttachment = {
          id: attachment.attachment_id,
          key: uploaded.key,
          filename: attachment.filename,
          media_type: attachment.content_type,
          size: buffer.length,
        }

        return {
          context: buildUploadedFileContext(displayName, attachment.content_type, buffer.length),
          stored,
        }
      } catch (error) {
        const cleanup = await Promise.allSettled([
          deleteFile({ key: storageKey, context: 'mothership' }),
          deleteFileMetadata(storageKey),
        ])
        for (const result of cleanup) {
          if (result.status === 'rejected')
            logger.warn('Failed to clean up unprepared inbox attachment', {
              taskId,
              key: storageKey,
              error: getErrorMessage(result.reason),
            })
        }
        throw error
      }
    })
  )

  const context: ChatContextItem[] = []
  const storedAttachments: PersistedFileAttachment[] = []
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled' && outcome.value) {
      context.push(outcome.value.context)
      storedAttachments.push(outcome.value.stored)
    } else if (outcome.status === 'rejected') {
      const attachment = attachments[i]
      context.push({
        type: 'uploaded_file',
        content: `Attachment "${attachment.filename}" could not be prepared and is unavailable. Other successfully prepared attachments remain readable.`,
      })
      logger.warn('Failed to prepare inbox attachment', {
        taskId,
        attachmentId: attachment.attachment_id,
        filename: attachment.filename,
        error: getErrorMessage(outcome.reason, 'Unknown error'),
      })
    }
  }

  logger.info('Prepared inbox attachments', {
    taskId,
    total: attachments.length,
    downloaded: storedAttachments.length,
  })

  return { context, storedAttachments }
}
