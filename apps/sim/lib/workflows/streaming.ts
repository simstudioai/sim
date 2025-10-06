/**
 * Shared streaming response utilities for workflow execution
 * Used by both /api/workflows/[id]/execute and /api/chat/[identifier]
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

export interface StreamingConfig {
  selectedOutputIds?: string[]
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

/**
 * Creates a streaming SSE response for workflow execution
 * This centralizes the streaming logic so it's not duplicated across routes
 */
export async function createStreamingResponse(
  options: StreamingResponseOptions
): Promise<ReadableStream> {
  const { requestId, workflow, input, executingUserId, streamConfig, createFilteredResult } =
    options

  const { executeWorkflow } = await import('@/app/api/workflows/[id]/execute/route')
  const { processStreamingBlockLogs } = await import('@/lib/tokenization')

  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        logger.debug(`[${requestId}] Stream started, setting up onStream callback`)
        const streamedContent = new Map<string, string>()

        // Set up onStream callback to forward agent streams
        const onStreamCallback = async (streamingExec: any) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          logger.debug(`[${requestId}] onStream callback invoked for block ${blockId}`)

          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()

          try {
            let chunkCount = 0
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                logger.debug(`[${requestId}] Stream reader finished after ${chunkCount} chunks`)
                break
              }

              chunkCount++
              // Decode the raw text chunk from the agent
              const textChunk = decoder.decode(value, { stream: true })

              // Accumulate for final event
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              // Format as SSE and forward to client
              const sseData = {
                blockId,
                chunk: textChunk,
              }
              const sseMessage = `data: ${JSON.stringify(sseData)}\n\n`
              controller.enqueue(encoder.encode(sseMessage))
              logger.debug(
                `[${requestId}] Forwarded chunk ${chunkCount} (${textChunk.length} chars) to client`
              )
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
          }
        }

        // Execute workflow with streaming enabled and onStream callback
        logger.debug(`[${requestId}] Calling executeWorkflow with streaming enabled`)
        const result = await executeWorkflow(workflow, requestId, input, executingUserId, {
          enabled: true,
          selectedOutputIds: streamConfig.selectedOutputIds,
          isSecureMode: streamConfig.isSecureMode,
          workflowTriggerType: streamConfig.workflowTriggerType,
          onStream: onStreamCallback,
        })

        logger.debug(`[${requestId}] Workflow execution completed, preparing final event`)

        // Update streamed content in logs
        if (result.logs && streamedContent.size > 0) {
          result.logs.forEach((log: any) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)
              if (log.output && content) {
                log.output.content = content
              }
            }
          })

          processStreamingBlockLogs(result.logs, streamedContent)
        }

        // Send final event with filtered data
        const finalData = createFilteredResult(result)
        const finalEvent = `data: ${JSON.stringify({ event: 'final', data: finalData })}\n\n`
        logger.debug(`[${requestId}] Sending final event, size: ${finalEvent.length} bytes`)
        controller.enqueue(encoder.encode(finalEvent))

        logger.debug(`[${requestId}] Closing stream`)
        controller.close()
      } catch (error: any) {
        logger.error(`[${requestId}] Stream error:`, error)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'error',
              error: error.message || 'Stream processing error',
            })}\n\n`
          )
        )
        controller.close()
      }
    },
  })
}
