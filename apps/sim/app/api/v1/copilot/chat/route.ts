import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/models'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { authenticateV1Request } from '@/app/api/v1/auth'

const logger = createLogger('CopilotHeadlessAPI')
const DEFAULT_COPILOT_MODEL = 'claude-opus-4-6'

const RequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  chatId: z.string().optional(),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  model: z.string().optional(),
  autoExecuteTools: z.boolean().optional().default(true),
  timeout: z.number().optional().default(300000),
})

/**
 * POST /api/v1/copilot/chat
 * Headless copilot endpoint for server-side orchestration.
 *
 * workflowId is optional - if not provided:
 * - If workflowName is provided, finds that workflow
 * - Otherwise uses the user's first workflow as context
 * - The copilot can still operate on any workflow using list_user_workflows
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateV1Request(req)
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.parse(body)
    const selectedModel = parsed.model || DEFAULT_COPILOT_MODEL

    // Resolve workflow ID
    const resolved = await resolveWorkflowIdForUser(
      auth.userId,
      parsed.workflowId,
      parsed.workflowName
    )
    if (!resolved) {
      return NextResponse.json(
        {
          success: false,
          error: 'No workflows found. Create a workflow first or provide a valid workflowId.',
        },
        { status: 400 }
      )
    }

    // Transform mode to transport mode (same as client API)
    // build and agent both map to 'agent' on the backend
    const effectiveMode = parsed.mode === 'agent' ? 'build' : parsed.mode
    const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

    // Always generate a chatId - required for artifacts system to work with subagents
    const chatId = parsed.chatId || crypto.randomUUID()

    const requestPayload = {
      message: parsed.message,
      workflowId: resolved.workflowId,
      userId: auth.userId,
      model: selectedModel,
      mode: transportMode,
      messageId: crypto.randomUUID(),
      version: SIM_AGENT_VERSION,
      headless: true,
      chatId,
    }

    const result = await orchestrateCopilotStream(requestPayload, {
      userId: auth.userId,
      workflowId: resolved.workflowId,
      chatId,
      autoExecuteTools: parsed.autoExecuteTools,
      timeout: parsed.timeout,
      interactive: false,
    })

    return NextResponse.json({
      success: result.success,
      content: result.content,
      toolCalls: result.toolCalls,
      chatId: result.chatId || chatId, // Return the chatId for conversation continuity
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
