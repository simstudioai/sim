import { createLogger } from '@sim/logger'
import { CopilotFiles } from '@/lib/uploads'
import { createFileContent } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('CopilotChatContext')

export interface FileAttachmentInput {
  id: string
  key: string
  name?: string
  filename?: string
  mimeType?: string
  media_type?: string
  size: number
}

export interface FileContent {
  type: string
  [key: string]: unknown
}

/**
 * Process file attachments into content for the payload.
 */
export async function processFileAttachments(
  fileAttachments: FileAttachmentInput[],
  userId: string
): Promise<FileContent[]> {
  if (!Array.isArray(fileAttachments) || fileAttachments.length === 0) return []

  const processedFileContents: FileContent[] = []
  const requestId = `copilot-${userId}-${Date.now()}`
  const processedAttachments = await CopilotFiles.processCopilotAttachments(
    fileAttachments as Parameters<typeof CopilotFiles.processCopilotAttachments>[0],
    requestId
  )

  for (const { buffer, attachment } of processedAttachments) {
    const fileContent = createFileContent(buffer, attachment.media_type)
    if (fileContent) {
      const enriched: FileContent = { ...fileContent, filename: attachment.filename }
      processedFileContents.push(enriched)
    }
  }

  logger.debug('Processed file attachments for payload', {
    userId,
    inputCount: fileAttachments.length,
    outputCount: processedFileContents.length,
  })

  return processedFileContents
}
