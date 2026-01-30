import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateV1Request } from '@/app/api/v1/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'

const logger = createLogger('CopilotHeadlessAPI')

const RequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  workflowId: z.string().min(1, 'workflowId is required'),
  chatId: z.string().optional(),
  mode: z.enum(['agent', 'ask', 'plan']).optional().default('agent'),
  model: z.string().optional(),
  autoExecuteTools: z.boolean().optional().default(true),
  timeout: z.number().optional().default(300000),
})

/**
 * POST /api/v1/copilot/chat
 * Headless copilot endpoint for server-side orchestration.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateV1Request(req)
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.parse(body)
    const defaults = getCopilotModel('chat')
    const selectedModel = parsed.model || defaults.model

    const requestPayload = {
      message: parsed.message,
      workflowId: parsed.workflowId,
      userId: auth.userId,
      stream: true,
      streamToolCalls: true,
      model: selectedModel,
      mode: parsed.mode,
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      ...(parsed.chatId ? { chatId: parsed.chatId } : {}),
    }

    const result = await orchestrateCopilotStream(requestPayload, {
      userId: auth.userId,
      workflowId: parsed.workflowId,
      chatId: parsed.chatId,
      autoExecuteTools: parsed.autoExecuteTools,
      timeout: parsed.timeout,
      interactive: false,
    })

    return NextResponse.json({
      success: result.success,
      content: result.content,
      toolCalls: result.toolCalls,
      chatId: result.chatId,
      conversationId: result.conversationId,
      error: result.error,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Headless copilot request failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

