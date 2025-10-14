import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/workflows/execution-file-storage'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WebhookAttachmentProcessor')

export interface WebhookAttachment {
  name: string
  data: Buffer
  contentType: string
  size: number
}

/**
 * Processes webhook/trigger attachments and converts them to UserFile objects.
 * This enables triggers to include file attachments that get automatically stored
 * in the execution filesystem and made available as UserFile objects for workflow use.
 */
export class WebhookAttachmentProcessor {
  /**
   * Process attachments and upload them to execution storage
   */
  static async processAttachments(
    attachments: WebhookAttachment[],
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
    },
    requestId: string
  ): Promise<UserFile[]> {
    if (!attachments || attachments.length === 0) {
      return []
    }

    logger.info(
      `[${requestId}] Processing ${attachments.length} attachments for execution ${executionContext.executionId}`
    )

    const processedFiles: UserFile[] = []

    for (const attachment of attachments) {
      try {
        const userFile = await WebhookAttachmentProcessor.processAttachment(
          attachment,
          executionContext,
          requestId
        )
        processedFiles.push(userFile)
      } catch (error) {
        logger.error(`[${requestId}] Error processing attachment '${attachment.name}':`, error)
        // Continue with other attachments rather than failing the entire request
      }
    }

    logger.info(
      `[${requestId}] Successfully processed ${processedFiles.length}/${attachments.length} attachments`
    )

    return processedFiles
  }

  /**
   * Process a single attachment and upload to execution storage
   */
  private static async processAttachment(
    attachment: WebhookAttachment,
    executionContext: {
      workspaceId: string
      workflowId: string
      executionId: string
    },
    requestId: string
  ): Promise<UserFile> {
    // Validate attachment
    if (!Buffer.isBuffer(attachment.data)) {
      throw new Error(`Attachment '${attachment.name}' data must be a Buffer`)
    }

    if (attachment.data.length === 0) {
      throw new Error(`Attachment '${attachment.name}' has zero bytes`)
    }

    logger.info(
      `[${requestId}] Uploading attachment '${attachment.name}' (${attachment.size} bytes, ${attachment.contentType})`
    )

    // Upload to execution storage
    const userFile = await uploadExecutionFile(
      executionContext,
      attachment.data,
      attachment.name,
      attachment.contentType
    )

    logger.info(
      `[${requestId}] Successfully stored attachment '${attachment.name}' with key: ${userFile.key}`
    )

    return userFile
  }
}
