import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: {
    stream: ReadableStream
    execution?: { blockId?: string }
  }) => Promise<void>
}

export interface StreamingResponseOptions {
  requestId: string
  workflow: { id: string; userId: string; isDeployed?: boolean }
  input: any
  executingUserId: string
  streamConfig: StreamingConfig
  createFilteredResult: (result: ExecutionResult) => any
}

export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  const { requestId, workflow, input, executingUserId, streamConfig, createFilteredResult } =
    options

  const { executeWorkflow, createFilteredResult: defaultFilteredResult } = await import(
    '@/app/api/workflows/[id]/execute/route'
  )
  const filterResultFn = createFilteredResult || defaultFilteredResult

  return new ReadableStream({
    async start(controller) {
      try {
        const streamedContent = new Map<string, string>()
        const processedOutputs = new Set<string>()

        const sendChunk = (blockId: string, content: string) => {
          const separator = processedOutputs.size > 0 ? '\n\n' : ''
          controller.enqueue(encodeSSE({ blockId, chunk: separator + content }))
          processedOutputs.add(blockId)
        }

        const onStreamCallback = async (streamingExec: {
          stream: ReadableStream
          execution?: { blockId?: string }
        }) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()
          let isFirstChunk = true

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const textChunk = decoder.decode(value, { stream: true })
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              if (isFirstChunk) {
                sendChunk(blockId, textChunk)
                isFirstChunk = false
              } else {
                controller.enqueue(encodeSSE({ blockId, chunk: textChunk }))
              }
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
            controller.enqueue(
              encodeSSE({
                event: 'stream_error',
                blockId,
                error: streamError instanceof Error ? streamError.message : 'Stream reading error',
              })
            )
          }
        }

        const onBlockCompleteCallback = async (blockId: string, output: any) => {
          if (!streamConfig.selectedOutputs?.length) return

          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          const matchingOutputs = streamConfig.selectedOutputs.filter(
            (outputId) => extractBlockIdFromOutputId(outputId) === blockId
          )

          if (!matchingOutputs.length) return

          for (const outputId of matchingOutputs) {
            const path = extractPathFromOutputId(outputId, blockId)

            // Response blocks have their data nested under 'response'
            let outputValue = traverseObjectPath(output, path)
            if (outputValue === undefined && output.response) {
              outputValue = traverseObjectPath(output.response, path)
            }

            if (outputValue !== undefined) {
              const formattedOutput =
                typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue, null, 2)
              sendChunk(blockId, formattedOutput)
            }
          }
        }

        const result = await executeWorkflow(workflow, requestId, input, executingUserId, {
          enabled: true,
          selectedOutputs: streamConfig.selectedOutputs,
          isSecureMode: streamConfig.isSecureMode,
          workflowTriggerType: streamConfig.workflowTriggerType,
          onStream: onStreamCallback,
          onBlockComplete: onBlockCompleteCallback,
        })

        if (result.logs && streamedContent.size > 0) {
          result.logs = result.logs.map((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)
              if (log.output && content) {
                return { ...log, output: { ...log.output, content } }
              }
            }
            return log
          })

          const { processStreamingBlockLogs } = await import('@/lib/tokenization')
          processStreamingBlockLogs(result.logs, streamedContent)
        }

        // Create a minimal result with only selected outputs
        const minimalResult = {
          success: result.success,
          error: result.error,
          output: {} as any,
        }

        // If there are selected outputs, only include those specific fields
        if (streamConfig.selectedOutputs?.length && result.output) {
          const { extractBlockIdFromOutputId, extractPathFromOutputId, traverseObjectPath } =
            await import('@/lib/response-format')

          for (const outputId of streamConfig.selectedOutputs) {
            const blockId = extractBlockIdFromOutputId(outputId)
            const path = extractPathFromOutputId(outputId, blockId)

            // Find the output value from the result
            if (result.logs) {
              const blockLog = result.logs.find((log: any) => log.blockId === blockId)
              if (blockLog?.output) {
                // Response blocks have their data nested under 'response'
                let value = traverseObjectPath(blockLog.output, path)
                if (value === undefined && blockLog.output.response) {
                  value = traverseObjectPath(blockLog.output.response, path)
                }
                if (value !== undefined) {
                  // Store it in a structured way
                  if (!minimalResult.output[blockId]) {
                    minimalResult.output[blockId] = {}
                  }
                  minimalResult.output[blockId][path] = value
                }
              }
            }
          }
        } else if (!streamConfig.selectedOutputs?.length) {
          // No selected outputs means include the full output (but still filtered)
          minimalResult.output = result.output
        }

        controller.enqueue(encodeSSE({ event: 'final', data: minimalResult }))
        controller.enqueue(encodeSSE('[DONE]'))
        controller.close()
      } catch (error: any) {
        logger.error(`[${requestId}] Stream error:`, error)
        controller.enqueue(
          encodeSSE({ event: 'error', error: error.message || 'Stream processing error' })
        )
        controller.close()
      }
    },
  })
}
