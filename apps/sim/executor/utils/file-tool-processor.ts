import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/workflows/execution-file-storage'
import type { ExecutionContext, FileReference } from '@/executor/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const logger = createLogger('FileToolProcessor')

/**
 * Processes tool outputs and converts file-typed outputs to FileReference objects
 */
export class FileToolProcessor {
  /**
   * Process tool outputs and convert file-typed outputs to FileReference objects
   */
  static async processToolOutputs(
    toolOutput: any,
    toolConfig: ToolConfig,
    executionContext: ExecutionContext
  ): Promise<any> {
    if (!toolConfig.outputs) {
      return toolOutput
    }

    const processedOutput = { ...toolOutput }

    for (const [outputKey, outputDef] of Object.entries(toolConfig.outputs)) {
      if (outputDef.type === 'file' || outputDef.type === 'file[]') {
        const fileData = processedOutput[outputKey]

        if (!fileData) {
          logger.warn(`File-typed output '${outputKey}' is missing from tool result`)
          continue
        }

        try {
          if (outputDef.type === 'file[]') {
            // Process array of files
            if (!Array.isArray(fileData)) {
              throw new Error(`Output '${outputKey}' is marked as file[] but is not an array`)
            }

            processedOutput[outputKey] = await Promise.all(
              fileData.map((file, index) =>
                FileToolProcessor.processFileData(file, executionContext, `${outputKey}[${index}]`)
              )
            )
          } else {
            // Process single file
            processedOutput[outputKey] = await FileToolProcessor.processFileData(
              fileData,
              executionContext,
              outputKey
            )
          }
        } catch (error) {
          logger.error(`Error processing file output '${outputKey}':`, error)
          throw new Error(`Failed to process file output '${outputKey}': ${error.message}`)
        }
      }
    }

    return processedOutput
  }

  /**
   * Convert various file data formats to FileReference by storing in execution filesystem
   */
  private static async processFileData(
    fileData: ToolFileData,
    context: ExecutionContext,
    outputKey: string
  ): Promise<FileReference> {
    logger.info(`Processing file data for output '${outputKey}': ${fileData.name}`)
    console.log(`File data structure:`, {
      name: fileData.name,
      mimeType: fileData.mimeType,
      size: fileData.size,
      dataType: typeof fileData.data,
      isBuffer: Buffer.isBuffer(fileData.data),
      hasUrl: !!fileData.url,
      dataStructure:
        fileData.data && typeof fileData.data === 'object'
          ? Object.keys(fileData.data)
          : 'primitive',
    })

    try {
      // Convert various formats to Buffer
      let buffer: Buffer

      if (Buffer.isBuffer(fileData.data)) {
        buffer = fileData.data
        logger.info(`Using Buffer data for ${fileData.name} (${buffer.length} bytes)`)
      } else if (
        fileData.data &&
        typeof fileData.data === 'object' &&
        fileData.data.type === 'Buffer' &&
        Array.isArray(fileData.data.data)
      ) {
        // Handle serialized Buffer objects (from JSON serialization)
        buffer = Buffer.from(fileData.data.data)
        logger.info(
          `Converted serialized Buffer to Buffer for ${fileData.name} (${buffer.length} bytes)`
        )
      } else if (typeof fileData.data === 'string') {
        // Assume base64 or base64url
        let base64Data = fileData.data

        // Convert base64url to base64 if needed (Gmail API format)
        if (base64Data.includes('-') || base64Data.includes('_')) {
          base64Data = base64Data.replace(/-/g, '+').replace(/_/g, '/')
        }

        buffer = Buffer.from(base64Data, 'base64')
        logger.info(
          `Converted base64 string to Buffer for ${fileData.name} (${buffer.length} bytes)`
        )
      } else if (fileData.url) {
        // Download from URL
        logger.info(`Downloading file from URL: ${fileData.url}`)
        const response = await fetch(fileData.url)

        if (!response.ok) {
          throw new Error(`Failed to download file from ${fileData.url}: ${response.statusText}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
        logger.info(`Downloaded file from URL for ${fileData.name} (${buffer.length} bytes)`)
      } else {
        throw new Error(
          `File data for '${fileData.name}' must have either 'data' (Buffer/base64) or 'url' property`
        )
      }

      // Validate buffer
      if (buffer.length === 0) {
        throw new Error(`File '${fileData.name}' has zero bytes`)
      }

      // Store in execution filesystem
      const fileReference = await uploadExecutionFile(
        context,
        buffer,
        fileData.name,
        fileData.mimeType
      )

      logger.info(
        `Successfully stored file '${fileData.name}' in execution filesystem with key: ${fileReference.key}`
      )
      return fileReference
    } catch (error) {
      logger.error(`Error processing file data for '${fileData.name}':`, error)
      throw error
    }
  }

  /**
   * Check if a tool has any file-typed outputs
   */
  static hasFileOutputs(toolConfig: ToolConfig): boolean {
    if (!toolConfig.outputs) {
      return false
    }

    return Object.values(toolConfig.outputs).some(
      (output) => output.type === 'file' || output.type === 'file[]'
    )
  }
}
