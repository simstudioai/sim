import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat-payload'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { generateWorkspaceContext } from '@/lib/copilot/workspace-context'
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
})

/**
 * POST /api/mothership/execute
 *
 * Non-streaming endpoint for Mothership block execution within workflows.
 * Called by the executor via internal JWT auth, not by the browser directly.
 * Consumes the Go SSE stream internally and returns a single JSON response.
 */
export async function POST(req: NextRequest) {
  let messageId: string | undefined

  try {
    const auth = await checkInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { messages, responseFormat, workspaceId, userId, chatId } =
      ExecuteRequestSchema.parse(body)

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const effectiveChatId = chatId || crypto.randomUUID()
    messageId = crypto.randomUUID()
    const reqLogger = logger.withMetadata({ messageId })
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

    const executionId = crypto.randomUUID()
    const runId = crypto.randomUUID()

    await createRunSegment({
      id: runId,
      executionId,
      chatId: effectiveChatId,
      userId,
      workspaceId,
      streamId: messageId,
    }).catch(() => {})

    const result = await orchestrateCopilotStream(requestPayload, {
      userId,
      workspaceId,
      chatId: effectiveChatId,
      executionId,
      runId,
      goRoute: '/api/mothership/execute',
      autoExecuteTools: true,
      interactive: false,
    })

    if (!result.success) {
      reqLogger.error('Mothership execute failed', {
        error: result.error,
        errors: result.errors,
      })
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.withMetadata({ messageId }).error('Mothership execute error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
