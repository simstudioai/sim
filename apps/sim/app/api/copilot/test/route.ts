/**
 * POST /api/copilot/test
 *
 * Simple test endpoint for copilot without authentication.
 * Pass just a query and optional userId to test headless mode.
 *
 * Request body:
 * {
 *   query: string,           // Required - the message to send
 *   userId?: string,         // Optional - defaults to 'test-user'
 *   workflowId?: string,     // Optional - workflow context
 *   workspaceId?: string,    // Optional - workspace context
 *   stream?: boolean,        // Optional - defaults to true
 * }
 */

import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { SIM_AGENT_API_URL_DEFAULT, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import {
  handleToolCallEvent,
  registerServerHandledTool,
} from '@/lib/copilot/server-executor/stream-handler'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CopilotTestAPI')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const TestRequestSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  userId: z.string().optional().default('test-user'),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  stream: z.boolean().optional().default(true),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, userId, workflowId, workspaceId, stream } = TestRequestSchema.parse(body)

    logger.info('Test copilot request', { query, userId, workflowId, workspaceId, stream })

    // Build execution context
    const executionContext = {
      userId,
      workflowId,
      workspaceId,
    }

    // Build request payload for Go copilot
    const requestPayload = {
      message: query,
      workflowId,
      userId,
      stream: stream,
      streamToolCalls: true,
      model: 'claude-sonnet-4-20250514',
      mode: 'agent',
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      executionContext,
    }

    logger.info('Sending to Go copilot', { url: `${SIM_AGENT_API_URL}/api/chat-completion-streaming` })

    const simAgentResponse = await fetch(`${SIM_AGENT_API_URL}/api/chat-completion-streaming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text().catch(() => '')
      logger.error('Go copilot error', { status: simAgentResponse.status, error: errorText })
      return NextResponse.json(
        { error: `Copilot error: ${simAgentResponse.statusText}`, details: errorText },
        { status: simAgentResponse.status }
      )
    }

    if (stream && simAgentResponse.body) {
      // Create streaming response
      const transformedStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          const reader = simAgentResponse.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              buffer += chunk

              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (line.trim() === '') continue

                if (line.startsWith('data: ') && line.length > 6) {
                  try {
                    const jsonStr = line.slice(6)
                    const event = JSON.parse(jsonStr)

                    // Handle tool calls server-side
                    if (event.type === 'tool_call' && !event.data?.partial && event.data?.id) {
                      const toolContext = {
                        userId,
                        workflowId: event.data.executionContext?.workflowId || workflowId,
                        workspaceId: event.data.executionContext?.workspaceId || workspaceId,
                        chatId: undefined,
                      }

                      handleToolCallEvent(
                        {
                          id: event.data.id,
                          name: event.data.name,
                          arguments: event.data.arguments || {},
                          partial: false,
                        },
                        toolContext
                      ).then((handledServerSide) => {
                        if (handledServerSide) {
                          registerServerHandledTool(event.data.id, event.data.name)
                          logger.info('Tool executed server-side', {
                            toolCallId: event.data.id,
                            toolName: event.data.name,
                          })
                        }
                      })
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }

                // Forward all events to client
                controller.enqueue(encoder.encode(line + '\n'))
              }
            }

            // Handle remaining buffer
            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer + '\n'))
            }
          } catch (error) {
            logger.error('Stream error', { error })
          } finally {
            controller.close()
          }
        },
      })

      return new Response(transformedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    } else {
      // Non-streaming response
      const text = await simAgentResponse.text()
      return NextResponse.json({ response: text })
    }
  } catch (error) {
    logger.error('Test endpoint error', { error })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Internal error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
