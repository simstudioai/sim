import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/workflows/execution-file-storage'
import type { ExecutionContext, UserFile } from '@/executor/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const logger = createLogger('FileToolProcessor')

/**
 * Processes tool outputs and converts file-typed outputs to UserFile objects.
 * This enables tools to return file data that gets automatically stored in the
 * execution filesystem and made available as UserFile objects for workflow use.
 */
export class FileToolProcessor {
  /**
   * Process tool outputs and convert file-typed outputs to UserFile objects
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

    // Process each output that's marked as file or file[]
    for (const [outputKey, outputDef] of Object.entries(toolConfig.outputs)) {
      if (!FileToolProcessor.isFileOutput(outputDef.type)) {
        continue
      }

      const fileData = processedOutput[outputKey]
      if (!fileData) {
        logger.warn(`File-typed output '${outputKey}' is missing from tool result`)
        continue
      }

      try {
        processedOutput[outputKey] = await FileToolProcessor.processFileOutput(
          fileData,
          outputDef.type,
          outputKey,
          executionContext
        )
      } catch (error) {
        logger.error(`Error processing file output '${outputKey}':`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to process file output '${outputKey}': ${errorMessage}`)
      }
    }

    return processedOutput
  }

  /**
   * Check if an output type is file-related
   */
  private static isFileOutput(type: string): boolean {
    return type === 'file' || type === 'file[]'
  }

  /**
   * Process a single file output (either single file or array of files)
   */
  private static async processFileOutput(
    fileData: any,
    outputType: string,
    outputKey: string,
    executionContext: ExecutionContext
  ): Promise<UserFile | UserFile[]> {
    if (outputType === 'file[]') {
      return FileToolProcessor.processFileArray(fileData, outputKey, executionContext)
    }
    return FileToolProcessor.processFileData(fileData, executionContext, outputKey)
  }

  /**
   * Process an array of files
   */
  private static async processFileArray(
    fileData: any,
    outputKey: string,
    executionContext: ExecutionContext
  ): Promise<UserFile[]> {
    if (!Array.isArray(fileData)) {
      throw new Error(`Output '${outputKey}' is marked as file[] but is not an array`)
    }

    return Promise.all(
      fileData.map((file, index) =>
        FileToolProcessor.processFileData(file, executionContext, `${outputKey}[${index}]`)
      )
    )
  }

  /**
   * Convert various file data formats to UserFile by storing in execution filesystem
   */
  private static async processFileData(
    fileData: ToolFileData,
    context: ExecutionContext,
    outputKey: string
  ): Promise<UserFile> {
    logger.info(`Processing file data for output '${outputKey}': ${fileData.name}`)
    try {
      // Convert various formats to Buffer
      let buffer: Buffer

      if (Buffer.isBuffer(fileData.data)) {
        buffer = fileData.data
        logger.info(`Using Buffer data for ${fileData.name} (${buffer.length} bytes)`)
      } else if (
        fileData.data &&
        typeof fileData.data === 'object' &&
        'type' in fileData.data &&
        'data' in fileData.data
      ) {
        // Handle serialized Buffer objects (from JSON serialization)
        const serializedBuffer = fileData.data as { type: string; data: number[] }
        if (serializedBuffer.type === 'Buffer' && Array.isArray(serializedBuffer.data)) {
          buffer = Buffer.from(serializedBuffer.data)
        } else {
          throw new Error(`Invalid serialized buffer format for ${fileData.name}`)
        }
        logger.info(
          `Converted serialized Buffer to Buffer for ${fileData.name} (${buffer.length} bytes)`
        )
      } else if (typeof fileData.data === 'string' && fileData.data) {
        // Assume base64 or base64url
        let base64Data = fileData.data

        // Convert base64url to base64 if needed (Gmail API format)
        if (base64Data && (base64Data.includes('-') || base64Data.includes('_'))) {
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
      const userFile = await uploadExecutionFile(
        {
          workspaceId: context.workspaceId || '',
          workflowId: context.workflowId,
          executionId: context.executionId || '',
        },
        buffer,
        fileData.name,
        fileData.mimeType
      )

      logger.info(
        `Successfully stored file '${fileData.name}' in execution filesystem with key: ${userFile.key}`
      )
      return userFile
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
