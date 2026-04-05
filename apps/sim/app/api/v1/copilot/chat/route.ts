import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/models'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { generateId } from '@/lib/core/utils/uuid'
import { getWorkflowById, resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { authenticateV1Request } from '@/app/api/v1/auth'

export const maxDuration = 3600

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
  timeout: z.number().optional().default(3_600_000),
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
  let messageId: string | undefined
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
      parsed.workflowName,
      auth.keyType === 'workspace' ? auth.workspaceId : undefined
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

    if (auth.keyType === 'workspace' && auth.workspaceId) {
      const workflow = await getWorkflowById(resolved.workflowId)
      if (!workflow?.workspaceId || workflow.workspaceId !== auth.workspaceId) {
        return NextResponse.json(
          { success: false, error: 'API key is not authorized for this workspace' },
          { status: 403 }
        )
      }
    }

    // Transform mode to transport mode (same as client API)
    // build and agent both map to 'agent' on the backend
    const effectiveMode = parsed.mode === 'agent' ? 'build' : parsed.mode
    const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

    // Always generate a chatId - required for artifacts system to work with subagents
    const chatId = parsed.chatId || generateId()

    messageId = generateId()
    const reqLogger = logger.withMetadata({ messageId })
    reqLogger.info('Received headless copilot chat start request', {
      workflowId: resolved.workflowId,
      workflowName: parsed.workflowName,
      chatId,
      mode: transportMode,
      autoExecuteTools: parsed.autoExecuteTools,
      timeout: parsed.timeout,
    })
    const requestPayload = {
      message: parsed.message,
      workflowId: resolved.workflowId,
      userId: auth.userId,
      model: selectedModel,
      mode: transportMode,
      messageId,
      chatId,
    }

    const executionId = generateId()
    const runId = generateId()

    await createRunSegment({
      id: runId,
      executionId,
      chatId,
      userId: auth.userId,
      workflowId: resolved.workflowId,
      streamId: messageId,
    }).catch(() => {})

    const result = await orchestrateCopilotStream(requestPayload, {
      userId: auth.userId,
      workflowId: resolved.workflowId,
      chatId,
      executionId,
      runId,
      goRoute: '/api/mcp',
      autoExecuteTools: parsed.autoExecuteTools,
      timeout: parsed.timeout,
      interactive: false,
    })

    return NextResponse.json({
      success: result.success,
      content: result.content,
      toolCalls: result.toolCalls,
      chatId: result.chatId || chatId,
      error: result.error,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: error.errors },
        { status: 400 }
      )
    }

    logger.withMetadata({ messageId }).error('Headless copilot request failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
