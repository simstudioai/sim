import { createLogger } from '@/lib/logs/console-logger'
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
    selectedOutputIds: string[],
    responseFormat?: any
  ): ReadableStream {
    // Check if this block has response format selected outputs
    const hasResponseFormatSelection = selectedOutputIds.some((outputId) => {
      const blockIdForOutput = outputId.includes('_')
        ? outputId.split('_')[0]
        : outputId.split('.')[0]
      return blockIdForOutput === blockId && outputId.includes('_')
    })

    // If no response format selection, return original stream unchanged
    if (!hasResponseFormatSelection || !responseFormat) {
      return originalStream
    }

    // Get the selected field names for this block
    const selectedFields = selectedOutputIds
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
    let hasProcessedComplete = false // Track if we've already processed the complete JSON

    const self = this

    return new ReadableStream({
      async start(controller) {
        const reader = originalStream.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              // Handle any remaining buffer at the end only if we haven't processed complete JSON yet
              if (buffer.trim() && !hasProcessedComplete) {
                self.processCompleteJson(buffer, selectedFields, controller)
              }
              controller.close()
              break
            }

            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            // Try to process the current buffer only if we haven't processed complete JSON yet
            if (!hasProcessedComplete) {
              const processedChunk = self.processStreamingChunk(buffer, selectedFields)

              if (processedChunk) {
                controller.enqueue(new TextEncoder().encode(processedChunk))
                hasProcessedComplete = true // Mark as processed to prevent duplicate processing
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
    // For streaming response format, we need to parse the JSON as it comes in
    // and extract only the field values we care about

    // Try to parse as complete JSON first
    try {
      const parsed = JSON.parse(buffer.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        // We have a complete JSON object, extract the selected fields
        // Process all selected fields and format them properly
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          // Join multiple fields with newlines for readability
          const result = results.join('\n')
          return result
        }

        return null
      }
    } catch (e) {
      // Not complete JSON yet, continue buffering
    }

    // For real-time extraction during streaming, we'd need more sophisticated parsing
    // For now, let's handle the case where we receive chunks that might be partial JSON

    // Simple heuristic: if buffer contains what looks like a complete JSON object
    const openBraces = (buffer.match(/\{/g) || []).length
    const closeBraces = (buffer.match(/\}/g) || []).length

    if (openBraces > 0 && openBraces === closeBraces) {
      // Likely a complete JSON object
      try {
        const parsed = JSON.parse(buffer.trim())
        if (typeof parsed === 'object' && parsed !== null) {
          // Process all selected fields and format them properly
          const results: string[] = []
          for (const field of selectedFields) {
            if (field in parsed) {
              const value = parsed[field]
              const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
              results.push(formattedValue)
            }
          }

          if (results.length > 0) {
            // Join multiple fields with newlines for readability
            const result = results.join('\n')
            return result
          }

          return null
        }
      } catch (e) {
        // Still not valid JSON, continue
      }
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
        // Process all selected fields and format them properly
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          // Join multiple fields with newlines for readability
          const result = results.join('\n')
          controller.enqueue(new TextEncoder().encode(result))
        }
      }
    } catch (error) {
      logger.warn('Failed to parse complete JSON in streaming processor:', { error })
    }
  }
}

// Create singleton instance
export const streamingResponseFormatProcessor = new StreamingResponseFormatProcessor()
