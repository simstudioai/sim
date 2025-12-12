import { createLogger } from '@/lib/logs/console/logger'
import type { ResponseFormatStreamProcessor } from '@/executor/types'

const logger = createLogger('ExecutorUtils')

/**
 * Processes a streaming response to extract only the selected response format fields
 * instead of streaming the full JSON wrapper.
 */
export class StreamingResponseFormatProcessor implements ResponseFormatStreamProcessor {
  processStream(
    originalStream: ReadableStream,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: any
  ): ReadableStream {
    const hasResponseFormatSelection = selectedOutputs.some((outputId) => {
      const blockIdForOutput = outputId.includes('_')
        ? outputId.split('_')[0]
        : outputId.split('.')[0]
      return blockIdForOutput === blockId && outputId.includes('_')
    })

    if (!hasResponseFormatSelection || !responseFormat) {
      return originalStream
    }

    const selectedFields = selectedOutputs
      .filter((outputId) => {
        const blockIdForOutput = outputId.includes('_')
          ? outputId.split('_')[0]
          : outputId.split('.')[0]
        return blockIdForOutput === blockId && outputId.includes('_')
      })
      .map((outputId) => outputId.substring(blockId.length + 1))

    logger.info('Processing streaming response format', {
      blockId,
      selectedFields,
      hasResponseFormat: !!responseFormat,
      selectedFieldsCount: selectedFields.length,
    })

    return this.createProcessedStream(originalStream, selectedFields, blockId)
  }

  private createProcessedStream(
    originalStream: ReadableStream,
    selectedFields: string[],
    blockId: string
  ): ReadableStream {
    let buffer = ''
    let hasProcessedComplete = false

    const self = this

    return new ReadableStream({
      async start(controller) {
        const reader = originalStream.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              if (buffer.trim() && !hasProcessedComplete) {
                self.processCompleteJson(buffer, selectedFields, controller)
              }
              controller.close()
              break
            }

            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            if (!hasProcessedComplete) {
              const processedChunk = self.processStreamingChunk(buffer, selectedFields)

              if (processedChunk) {
                controller.enqueue(new TextEncoder().encode(processedChunk))
                hasProcessedComplete = true
              }
            }
          }
        } catch (error) {
          logger.error('Error processing streaming response format:', { error, blockId })
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
    })
  }

  private processStreamingChunk(buffer: string, selectedFields: string[]): string | null {
    try {
      const parsed = JSON.parse(buffer.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          const result = results.join('\n')
          return result
        }

        return null
      }
    } catch (e) {}

    const openBraces = (buffer.match(/\{/g) || []).length
    const closeBraces = (buffer.match(/\}/g) || []).length

    if (openBraces > 0 && openBraces === closeBraces) {
      try {
        const parsed = JSON.parse(buffer.trim())
        if (typeof parsed === 'object' && parsed !== null) {
          const results: string[] = []
          for (const field of selectedFields) {
            if (field in parsed) {
              const value = parsed[field]
              const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
              results.push(formattedValue)
            }
          }

          if (results.length > 0) {
            const result = results.join('\n')
            return result
          }

          return null
        }
      } catch (e) {}
    }

    return null
  }

  private processCompleteJson(
    buffer: string,
    selectedFields: string[],
    controller: ReadableStreamDefaultController
  ): void {
    try {
      const parsed = JSON.parse(buffer.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          const result = results.join('\n')
          controller.enqueue(new TextEncoder().encode(result))
        }
      }
    } catch (error) {
      logger.warn('Failed to parse complete JSON in streaming processor:', { error })
    }
  }
}

export const streamingResponseFormatProcessor = new StreamingResponseFormatProcessor()
