import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE } from '@/lib/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

export interface StreamingConfig {
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: 'api' | 'chat'
  onStream?: (streamingExec: any) => Promise<void>
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

  const { executeWorkflow } = await import('@/app/api/workflows/[id]/execute/route')

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

        const onStreamCallback = async (streamingExec: any) => {
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
            const outputValue = traverseObjectPath(output, path)

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
          result.logs.forEach((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)
              if (log.output && content) log.output.content = content
            }
          })

          const { processStreamingBlockLogs } = await import('@/lib/tokenization')
          processStreamingBlockLogs(result.logs, streamedContent)
        }

        controller.enqueue(encodeSSE({ event: 'final', data: createFilteredResult(result) }))
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
