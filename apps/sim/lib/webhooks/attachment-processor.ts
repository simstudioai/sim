import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
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
      requestId: string
    }
  ): Promise<UserFile[]> {
    if (!attachments || attachments.length === 0) {
      return []
    }

    logger.info(
      `[${executionContext.requestId}] Processing ${attachments.length} attachments for execution ${executionContext.executionId}`
    )

    const processedFiles: UserFile[] = []

    for (const attachment of attachments) {
      try {
        const userFile = await WebhookAttachmentProcessor.processAttachment(
          attachment,
          executionContext
        )
        processedFiles.push(userFile)
      } catch (error) {
        logger.error(
          `[${executionContext.requestId}] Error processing attachment '${attachment.name}':`,
          error
        )
        // Continue with other attachments rather than failing the entire request
      }
    }

    logger.info(
      `[${executionContext.requestId}] Successfully processed ${processedFiles.length}/${attachments.length} attachments`
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
      requestId: string
    }
  ): Promise<UserFile> {
    // Convert data to Buffer (handle both raw and serialized formats)
    let buffer: Buffer
    const data = attachment.data as any

    if (Buffer.isBuffer(data)) {
      // Raw Buffer (e.g., Teams in-memory processing)
      buffer = data
    } else if (
      data &&
      typeof data === 'object' &&
      data.type === 'Buffer' &&
      Array.isArray(data.data)
    ) {
      // Serialized Buffer (e.g., Gmail/Outlook after JSON roundtrip)
      buffer = Buffer.from(data.data)
    } else {
      throw new Error(`Attachment '${attachment.name}' data must be a Buffer or serialized Buffer`)
    }

    if (buffer.length === 0) {
      throw new Error(`Attachment '${attachment.name}' has zero bytes`)
    }

    logger.info(
      `[${executionContext.requestId}] Uploading attachment '${attachment.name}' (${attachment.size} bytes, ${attachment.contentType})`
    )

    // Upload to execution storage
    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      attachment.name,
      attachment.contentType
    )

    logger.info(
      `[${executionContext.requestId}] Successfully stored attachment '${attachment.name}' with key: ${userFile.key}`
    )

    return userFile
  }
}
