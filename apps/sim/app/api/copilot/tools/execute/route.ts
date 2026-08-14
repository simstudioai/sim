import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotToolExecuteInternalBodySchema } from '@/lib/api/contracts/copilot'
import { validationErrorResponse } from '@/lib/api/server'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { handleResourceSideEffects } from '@/lib/copilot/request/tools/resources'
import type { ToolCallResult } from '@/lib/copilot/request/types'
import { createServerToolHandler } from '@/lib/copilot/tools/registry/server-tool-adapter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotToolExecuteInternalAPI')

// POST /api/copilot/tools/execute — internal (Go → Sim) in-band execution of
// one sim-server tool announced on a LIVE mothership turn. This is what lets
// background (async) subagents — and the main lane while background agents are
// running — use sim-executed tools without a checkpoint pause: Go calls here
// synchronously instead of parking the turn, and the tool runs through the
// same server tool router the resume driver uses. Trusted server-to-server
// only: Go supplies the acting user, proven by the internal API secret.
export const POST = withRouteHandler((request: NextRequest) =>
  withIncomingGoSpan(
    request.headers,
    TraceSpan.CopilotToolsExecuteInband,
    undefined,
    async (rootSpan) => {
      const authResult = checkInternalApiKey(request)
      if (!authResult.success) {
        return NextResponse.json(
          { success: false, error: authResult.error || 'Authentication failed' },
          { status: 401 }
        )
      }

      // boundary-raw-json: tolerant parse; validation happens via the contract schema below
      const body = await request.json().catch(() => ({}))
      const validation = copilotToolExecuteInternalBodySchema.safeParse(body)
      if (!validation.success) {
        return validationErrorResponse(validation.error, 'Invalid request body')
      }
      const {
        toolCallId,
        toolName,
        params,
        userId,
        workflowId,
        workspaceId,
        chatId,
        messageId,
        parentToolCallId,
        userPermission,
      } = validation.data
      rootSpan.setAttributes({
        [TraceAttr.ToolName]: toolName,
        [TraceAttr.ToolCallId]: toolCallId,
        [TraceAttr.UserId]: userId,
      })

      try {
        const handler = createServerToolHandler(toolName)
        const result = await handler(params, {
          userId,
          workflowId: workflowId ?? '',
          workspaceId,
          chatId,
          messageId,
          toolCallId,
          parentToolCallId,
          userPermission,
          copilotToolExecution: true,
        })
        if (!result.success) {
          logger.warn('In-band tool execution failed', {
            toolName,
            toolCallId,
            error: result.error,
          })
        }
        if (result.success && chatId) {
          // Persist created/deleted resources on the chat (file chips, table
          // links) exactly like the resume driver does. No live event sink
          // exists for an out-of-band route, so chips surface from the
          // persisted chat resources rather than a mid-turn push.
          const asToolResult = { success: result.success, output: result.output } as ToolCallResult
          await handleResourceSideEffects(
            toolName,
            params,
            asToolResult,
            asToolResult,
            chatId,
            undefined,
            () => false
          ).catch((err) => {
            logger.warn('In-band resource side effects failed', {
              toolName,
              toolCallId,
              error: getErrorMessage(err),
            })
          })
        }
        return NextResponse.json({
          success: result.success,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.error ? { error: result.error } : {}),
        })
      } catch (err) {
        const message = getErrorMessage(err)
        logger.error('In-band tool execution threw', { toolName, toolCallId, error: message })
        return NextResponse.json({ success: false, error: message }, { status: 500 })
      }
    }
  )
)
