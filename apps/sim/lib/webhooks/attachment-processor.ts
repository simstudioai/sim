import { createLogger } from '@/lib/logs/console/logger'
import { uploadFileFromRawData } from '@/lib/uploads/contexts/execution'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WebhookAttachmentProcessor')

export interface WebhookAttachment {
  name: string
  data: Buffer
  contentType?: string
  mimeType?: string
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
      userId?: string
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
      userId?: string
    }
  ): Promise<UserFile> {
    return uploadFileFromRawData(
      {
        name: attachment.name,
        data: attachment.data,
        mimeType: attachment.contentType || attachment.mimeType,
      },
      executionContext,
      executionContext.userId
    )
  }
}
