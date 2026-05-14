import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { v1CopilotChatContract } from '@/lib/api/contracts/v1/copilot'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkflowById, resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { authenticateRequest } from '@/app/api/v1/middleware'

export const maxDuration = 3600

const logger = createLogger('CopilotHeadlessAPI')
const DEFAULT_COPILOT_MODEL = 'claude-opus-4-6'

/**
 * POST /api/v1/copilot/chat
 * Headless copilot endpoint for server-side orchestration.
 *
 * workflowId is optional - if not provided:
 * - If workflowName is provided, finds that workflow
 * - If exactly one workflow is available, uses that workflow as context
 * - Otherwise requires workflowId or workflowName to disambiguate
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  let messageId: string | undefined
  const authorized = await authenticateRequest(req, 'copilot-chat')
  if (authorized instanceof NextResponse) {
    return authorized
  }
  const { userId, rateLimit } = authorized
  const auth = {
    authenticated: true as const,
    userId,
    keyType: rateLimit.keyType,
    workspaceId: rateLimit.workspaceId,
  }

  try {
    const parsedRequest = await parseRequest(
      v1CopilotChatContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request'),
              details: error.issues,
            },
            { status: 400 }
          ),
        invalidJsonResponse: () =>
          NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 }),
      }
    )
    if (!parsedRequest.success) return parsedRequest.response

    const parsed = parsedRequest.data.body
    const selectedModel = parsed.model || DEFAULT_COPILOT_MODEL

    // Resolve workflow ID
    const resolved = await resolveWorkflowIdForUser(
      auth.userId,
      parsed.workflowId,
      parsed.workflowName,
      auth.keyType === 'workspace' ? auth.workspaceId : undefined
    )
    if (resolved.status !== 'resolved') {
      return NextResponse.json(
        {
          success: false,
          error: resolved.message,
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
    logger.info(
      messageId
        ? `Received headless copilot chat start request [messageId:${messageId}]`
        : 'Received headless copilot chat start request',
      {
        workflowId: resolved.workflowId,
        workflowName: parsed.workflowName,
        chatId,
        mode: transportMode,
        autoExecuteTools: parsed.autoExecuteTools,
        timeout: parsed.timeout,
      }
    )
    const requestPayload = {
      message: parsed.message,
      workflowId: resolved.workflowId,
      userId: auth.userId,
      model: selectedModel,
      mode: transportMode,
      messageId,
      chatId,
    }

    const result = await runHeadlessCopilotLifecycle(requestPayload, {
      userId: auth.userId,
      workflowId: resolved.workflowId,
      chatId,
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
    logger.error(
      messageId
        ? `Headless copilot request failed [messageId:${messageId}]`
        : 'Headless copilot request failed',
      {
        error: toError(error).message,
      }
    )
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
})
