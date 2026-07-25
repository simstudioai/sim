import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isUserFile } from '@/lib/core/utils/user-file'
import { uploadExecutionFile, uploadFileFromRawData } from '@/lib/uploads/contexts/execution'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE, sniffImageContentType } from '@/lib/uploads/utils/validation'
import type { ExecutionContext, UserFile } from '@/executor/types'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const logger = createLogger('FileToolProcessor')

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function assertFileSize(size: number, fileName: string): void {
  if (size > MAX_FILE_SIZE) {
    throw new Error(`File '${fileName}' exceeds the maximum allowed size of ${MAX_FILE_SIZE} bytes`)
  }
}

function resolveStoredFileMetadata(
  fileName: string,
  declaredMimeType: string,
  buffer: Buffer
): { fileName: string; mimeType: string } {
  if (!declaredMimeType.startsWith('image/')) {
    return { fileName, mimeType: declaredMimeType }
  }

  const mimeType = sniffImageContentType(buffer)
  if (!mimeType) {
    return {
      fileName: `${fileName.replace(/\.[^.]+$/, '')}.bin`,
      mimeType: 'application/octet-stream',
    }
  }

  const extension = IMAGE_FILE_EXTENSIONS[mimeType]
  return {
    fileName: extension ? `${fileName.replace(/\.[^.]+$/, '')}.${extension}` : fileName,
    mimeType,
  }
}

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
        const errorMessage = toError(error).message
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
    return FileToolProcessor.processFileData(fileData, executionContext)
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

    const files: UserFile[] = []
    for (const file of fileData) {
      files.push(await FileToolProcessor.processFileData(file, executionContext))
    }
    return files
  }

  /**
   * Convert various file data formats to UserFile by storing in execution filesystem.
   * If the input is already a UserFile, returns it unchanged.
   */
  private static async processFileData(
    fileData: ToolFileData | UserFile,
    context: ExecutionContext
  ): Promise<UserFile> {
    // If already a UserFile (e.g., from tools that handle their own file storage),
    // return it directly without re-processing
    if (isUserFile(fileData)) {
      return fileData as UserFile
    }

    const data = fileData as ToolFileData
    try {
      let buffer: Buffer | null = null

      if (Buffer.isBuffer(data.data)) {
        assertFileSize(data.data.length, data.name)
        buffer = data.data
      } else if (
        data.data &&
        typeof data.data === 'object' &&
        'type' in data.data &&
        'data' in data.data
      ) {
        const serializedBuffer = data.data as { type: string; data: number[] }
        if (serializedBuffer.type === 'Buffer' && Array.isArray(serializedBuffer.data)) {
          assertFileSize(serializedBuffer.data.length, data.name)
          buffer = Buffer.from(serializedBuffer.data)
        } else {
          throw new Error(`Invalid serialized buffer format for ${data.name}`)
        }
      } else if (typeof data.data === 'string' && data.data) {
        let base64Data = data.data

        if (base64Data.includes('-') || base64Data.includes('_')) {
          base64Data = base64Data.replace(/-/g, '+').replace(/_/g, '/')
        }

        const paddingBytes = base64Data.endsWith('==') ? 2 : base64Data.endsWith('=') ? 1 : 0
        assertFileSize(Math.floor((base64Data.length * 3) / 4) - paddingBytes, data.name)
        buffer = Buffer.from(base64Data, 'base64')
      }

      if (!buffer && data.url) {
        buffer = await downloadFileFromUrl(data.url, {
          maxBytes: MAX_FILE_SIZE,
          userId: context.userId,
        })
      }

      if (buffer) {
        if (buffer.length === 0) {
          throw new Error(`File '${data.name}' has zero bytes`)
        }
        assertFileSize(buffer.length, data.name)
        const storedMetadata = resolveStoredFileMetadata(data.name, data.mimeType, buffer)

        return await uploadExecutionFile(
          {
            workspaceId: context.workspaceId || '',
            workflowId: context.workflowId,
            executionId: context.executionId || '',
          },
          buffer,
          storedMetadata.fileName,
          storedMetadata.mimeType,
          context.userId
        )
      }

      if (!data.data) {
        throw new Error(
          `File data for '${data.name}' must have either 'data' (Buffer/base64) or 'url' property`
        )
      }

      return uploadFileFromRawData(
        {
          name: data.name,
          data: data.data,
          mimeType: data.mimeType,
        },
        {
          workspaceId: context.workspaceId || '',
          workflowId: context.workflowId,
          executionId: context.executionId || '',
        },
        context.userId
      )
    } catch (error) {
      logger.error(`Error processing file data for '${data.name}':`, error)
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
