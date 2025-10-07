/**
 * Shared streaming response utilities for workflow execution
 * Used by both /api/workflows/[id]/execute and /api/chat/[identifier]
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowStreaming')

/**
 * Standard SSE (Server-Sent Events) headers for streaming responses
 * Reused across all streaming endpoints
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

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
        const streamedContent = new Map<string, string>()

        // Set up onStream callback to forward agent streams
        const onStreamCallback = async (streamingExec: any) => {
          const blockId = streamingExec.execution?.blockId || 'unknown'
          const reader = streamingExec.stream.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const textChunk = decoder.decode(value, { stream: true })

              // Accumulate for logs/output
              streamedContent.set(blockId, (streamedContent.get(blockId) || '') + textChunk)

              // Send chunk in SSE format
              const sseMessage = `data: ${JSON.stringify({ blockId, chunk: textChunk })}\n\n`
              controller.enqueue(encoder.encode(sseMessage))
            }
          } catch (streamError) {
            logger.error(`[${requestId}] Error reading agent stream:`, streamError)
          }
        }

        // Execute workflow with streaming enabled
        const result = await executeWorkflow(workflow, requestId, input, executingUserId, {
          enabled: true,
          selectedOutputs: streamConfig.selectedOutputs,
          isSecureMode: streamConfig.isSecureMode,
          workflowTriggerType: streamConfig.workflowTriggerType,
          onStream: onStreamCallback,
        })

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

        // Send final event with execution metadata
        const finalData = createFilteredResult(result)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: 'done', ...finalData })}\n\n`)
        )

        // Send [DONE] marker
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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
