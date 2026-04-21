import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertActiveWorkspaceAccess,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export const maxDuration = 3600

const logger = createLogger('MothershipExecuteAPI')

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

const ExecuteRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1, 'At least one message is required'),
  responseFormat: z.any().optional(),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userId: z.string().min(1, 'userId is required'),
  chatId: z.string().optional(),
  messageId: z.string().optional(),
  requestId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * POST /api/mothership/execute
 *
 * Non-streaming endpoint for Mothership block execution within workflows.
 * Called by the executor via internal JWT auth, not by the browser directly.
 * Consumes the Go SSE stream internally and returns a single JSON response.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  let messageId: string | undefined
  let requestId: string | undefined

  try {
    const auth = await checkInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      messages,
      responseFormat,
      workspaceId,
      userId,
      chatId,
      messageId: providedMessageId,
      requestId: providedRequestId,
      workflowId,
      executionId,
    } = ExecuteRequestSchema.parse(body)

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const effectiveChatId = chatId || generateId()
    messageId = providedMessageId || generateId()
    requestId = providedRequestId || generateId()
    const reqLogger = logger.withMetadata({
      messageId,
      requestId,
      workflowId,
      executionId,
    })
    const [workspaceContext, integrationTools, userPermission] = await Promise.all([
      generateWorkspaceContext(workspaceId, userId),
      buildIntegrationToolSchemas(userId, messageId),
      getUserEntityPermissions(userId, 'workspace', workspaceId).catch(() => null),
    ])

    const requestPayload: Record<string, unknown> = {
      messages,
      responseFormat,
      userId,
      chatId: effectiveChatId,
      mode: 'agent',
      messageId,
      isHosted: true,
      workspaceContext,
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
      ...(userPermission ? { userPermission } : {}),
    }

    let allowExplicitAbort = true
    let explicitAbortRequest: Promise<void> | undefined
    const onAbort = () => {
      if (!allowExplicitAbort || explicitAbortRequest || !messageId) {
        return
      }

      explicitAbortRequest = requestExplicitStreamAbort({
        streamId: messageId,
        userId,
        chatId: effectiveChatId,
      }).catch((error) => {
        reqLogger.warn('Failed to send explicit abort for mothership execution', {
          error: toError(error).message,
        })
      })
    }

    if (req.signal.aborted) {
      onAbort()
    } else {
      req.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const result = await runHeadlessCopilotLifecycle(requestPayload, {
        userId,
        workspaceId,
        chatId: effectiveChatId,
        workflowId,
        executionId,
        simRequestId: requestId,
        goRoute: '/api/mothership/execute',
        autoExecuteTools: true,
        interactive: false,
        abortSignal: req.signal,
      })

      allowExplicitAbort = false

      if (req.signal.aborted) {
        reqLogger.info('Mothership execute aborted after lifecycle completion')
        return NextResponse.json({ error: 'Mothership execution aborted' }, { status: 499 })
      }

      if (!result.success) {
        logger.error(
          messageId
            ? `Mothership execute failed [messageId:${messageId}]`
            : 'Mothership execute failed',
          {
            requestId,
            workflowId,
            executionId,
            error: result.error,
            errors: result.errors,
          }
        )
        return NextResponse.json(
          {
            error: result.error || 'Mothership execution failed',
            content: result.content || '',
          },
          { status: 500 }
        )
      }

      const clientToolNames = new Set(integrationTools.map((t) => t.name))
      const clientToolCalls = (result.toolCalls || []).filter(
        (tc: { name: string }) => clientToolNames.has(tc.name) || tc.name.startsWith('mcp-')
      )

      return NextResponse.json({
        content: result.content,
        model: 'mothership',
        tokens: result.usage
          ? {
              prompt: result.usage.prompt,
              completion: result.usage.completion,
              total: (result.usage.prompt || 0) + (result.usage.completion || 0),
            }
          : {},
        cost: result.cost || undefined,
        toolCalls: clientToolCalls,
      })
    } finally {
      allowExplicitAbort = false
      req.signal.removeEventListener('abort', onAbort)
      await explicitAbortRequest
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    if (req.signal.aborted || isAbortError(error)) {
      logger.info(
        messageId
          ? `Mothership execute aborted [messageId:${messageId}]`
          : 'Mothership execute aborted',
        {
          requestId,
        }
      )

      return NextResponse.json({ error: 'Mothership execution aborted' }, { status: 499 })
    }

    logger.error(
      messageId ? `Mothership execute error [messageId:${messageId}]` : 'Mothership execute error',
      {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
})
