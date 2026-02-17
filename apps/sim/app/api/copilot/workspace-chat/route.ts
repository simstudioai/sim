import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'
import { getWorkspaceChatSystemPrompt } from '@/lib/copilot/workspace-prompt'

const logger = createLogger('WorkspaceChatAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const WorkspaceChatSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  chatId: z.string().optional(),
  model: z.string().optional().default('claude-opus-4-5'),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { message, workspaceId, chatId, model } = WorkspaceChatSchema.parse(body)

    const chatResult = await resolveOrCreateChat({
      chatId,
      userId: session.user.id,
      workspaceId,
      model,
    })

    const requestPayload: Record<string, unknown> = {
      message,
      userId: session.user.id,
      model,
      mode: 'agent',
      headless: true,
      systemPrompt: getWorkspaceChatSystemPrompt(),
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      source: 'workspace-chat',
      stream: true,
      ...(chatResult.chatId ? { chatId: chatResult.chatId } : {}),
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const pushEvent = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // Client disconnected
          }
        }

        if (chatResult.chatId) {
          pushEvent({ type: 'chat_id', chatId: chatResult.chatId })
        }

        try {
          const result = await orchestrateCopilotStream(requestPayload, {
            userId: session.user.id,
            workspaceId,
            chatId: chatResult.chatId || undefined,
            autoExecuteTools: true,
            interactive: false,
            onEvent: async (event: SSEEvent) => {
              pushEvent(event as unknown as Record<string, unknown>)
            },
          })

          if (chatResult.chatId && result.conversationId) {
            await db
              .update(copilotChats)
              .set({
                updatedAt: new Date(),
                conversationId: result.conversationId,
              })
              .where(eq(copilotChats.id, chatResult.chatId))
          }

          pushEvent({
            type: 'done',
            success: result.success,
            content: result.content,
          })
        } catch (error) {
          logger.error('Workspace chat orchestration failed', { error })
          pushEvent({
            type: 'error',
            error: error instanceof Error ? error.message : 'Chat failed',
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Workspace chat error', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
