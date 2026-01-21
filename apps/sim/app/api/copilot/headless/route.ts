import { db } from '@sim/db'
import { copilotChats, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_API_URL_DEFAULT, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { COPILOT_MODEL_IDS } from '@/lib/copilot/models'
import {
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import {
  createStream,
  completeStream,
  errorStream,
  updateStreamStatus,
} from '@/lib/copilot/stream-persistence'
import { executeToolServerSide, isServerExecutableTool } from '@/lib/copilot/tools/server/executor'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { env } from '@/lib/core/config/env'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

const logger = createLogger('HeadlessCopilotAPI')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const HeadlessRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  workflowId: z.string().min(1, 'Workflow ID is required'),
  chatId: z.string().optional(),
  model: z.enum(COPILOT_MODEL_IDS).optional(),
  mode: z.enum(['agent', 'build', 'chat']).optional().default('agent'),
  timeout: z.number().optional().default(300000), // 5 minute default
  persistChanges: z.boolean().optional().default(true),
  createNewChat: z.boolean().optional().default(false),
})

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

/**
 * POST /api/copilot/headless
 *
 * Execute copilot completely server-side without any client connection.
 * All tool calls are executed server-side and results are persisted directly.
 *
 * Returns the final result after all processing is complete.
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  const startTime = Date.now()

  try {
    // Authenticate via session or API key
    let userId: string | null = null

    const session = await getSession()
    if (session?.user?.id) {
      userId = session.user.id
    } else {
      // Try API key authentication from header
      const apiKey = req.headers.get('x-api-key')
      if (apiKey) {
        const authResult = await authenticateApiKeyFromHeader(apiKey)
        if (authResult.success && authResult.userId) {
          userId = authResult.userId
          // Update last used timestamp in background
          if (authResult.keyId) {
            updateApiKeyLastUsed(authResult.keyId).catch(() => {})
          }
        }
      }
    }

    if (!userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { message, workflowId, chatId, model, mode, timeout, persistChanges, createNewChat } =
      HeadlessRequestSchema.parse(body)

    logger.info(`[${tracker.requestId}] Headless copilot request`, {
      userId,
      workflowId,
      messageLength: message.length,
      mode,
    })

    // Verify user has access to workflow
    const [wf] = await db
      .select({ userId: workflowTable.userId, workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!wf) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // TODO: Add proper workspace access check
    if (wf.userId !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Load current workflow state from database
    const workflowData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow data not found' }, { status: 404 })
    }

    const sanitizedWorkflow = sanitizeForCopilot({
      blocks: workflowData.blocks,
      edges: workflowData.edges,
      loops: workflowData.loops,
      parallels: workflowData.parallels,
    })

    // Create a stream for tracking (even in headless mode)
    const streamId = crypto.randomUUID()
    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()

    await createStream({
      streamId,
      chatId: chatId || '',
      userId,
      workflowId,
      userMessageId,
      isClientSession: false, // Key: this is headless
    })

    await updateStreamStatus(streamId, 'streaming')

    // Handle chat persistence
    let actualChatId = chatId
    if (createNewChat && !chatId) {
      const { provider, model: defaultModel } = getCopilotModel('chat')
      const [newChat] = await db
        .insert(copilotChats)
        .values({
          userId,
          workflowId,
          title: null,
          model: model || defaultModel,
          messages: [],
        })
        .returning()

      if (newChat) {
        actualChatId = newChat.id
      }
    }

    // Get credentials for tools
    let credentials: {
      oauth: Record<string, { accessToken: string; accountId: string; name: string }>
      apiKeys: string[]
    } | null = null

    try {
      const rawCredentials = await getCredentialsServerTool.execute({ workflowId }, { userId })
      const oauthMap: Record<string, { accessToken: string; accountId: string; name: string }> = {}

      for (const cred of rawCredentials?.oauth?.connected?.credentials || []) {
        if (cred.accessToken) {
          oauthMap[cred.provider] = {
            accessToken: cred.accessToken,
            accountId: cred.id,
            name: cred.name,
          }
        }
      }

      credentials = {
        oauth: oauthMap,
        apiKeys: rawCredentials?.environment?.variableNames || [],
      }
    } catch (error) {
      logger.warn(`[${tracker.requestId}] Failed to fetch credentials`, { error })
    }

    // Build tool definitions
    const { createUserToolSchema } = await import('@/tools/params')
    const latestTools = getLatestVersionTools(tools)
    const integrationTools = Object.entries(latestTools).map(([toolId, toolConfig]) => {
      const userSchema = createUserToolSchema(toolConfig)
      const strippedName = stripVersionSuffix(toolId)
      return {
        name: strippedName,
        description: toolConfig.description || toolConfig.name || strippedName,
        input_schema: userSchema,
        defer_loading: true,
      }
    })

    // Build request payload
    const defaults = getCopilotModel('chat')
    const selectedModel = model || defaults.model
    const effectiveMode = mode === 'agent' ? 'build' : mode

    const requestPayload = {
      message,
      workflowId,
      userId,
      stream: false, // Non-streaming for headless
      model: selectedModel,
      mode: effectiveMode,
      version: SIM_AGENT_VERSION,
      messageId: userMessageId,
      ...(actualChatId && { chatId: actualChatId }),
      ...(integrationTools.length > 0 && { tools: integrationTools }),
      ...(credentials && { credentials }),
    }

    // Call sim agent (non-streaming)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(`${SIM_AGENT_API_URL}/api/chat-completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`[${tracker.requestId}] Sim agent error`, {
          status: response.status,
          error: errorText,
        })
        await errorStream(streamId, `Agent error: ${response.statusText}`)
        return NextResponse.json(
          { error: `Agent error: ${response.statusText}` },
          { status: response.status }
        )
      }

      const result = await response.json()

      // Execute tool calls server-side
      const toolResults: Record<string, { success: boolean; result?: unknown; error?: string }> = {}

      if (result.toolCalls && Array.isArray(result.toolCalls)) {
        for (const toolCall of result.toolCalls) {
          const toolName = toolCall.name
          const toolArgs = toolCall.arguments || toolCall.input || {}

          logger.info(`[${tracker.requestId}] Executing tool server-side`, {
            toolName,
            toolCallId: toolCall.id,
          })

          if (!isServerExecutableTool(toolName)) {
            logger.warn(`[${tracker.requestId}] Tool not executable server-side`, { toolName })
            toolResults[toolCall.id] = {
              success: false,
              error: `Tool ${toolName} requires client-side execution`,
            }
            continue
          }

          const toolResult = await executeToolServerSide(
            { name: toolName, args: toolArgs },
            { workflowId, userId, persistChanges }
          )

          toolResults[toolCall.id] = toolResult
        }
      }

      // Mark stream complete
      await completeStream(streamId, { content: result.content, toolResults })

      // Save to chat history
      if (actualChatId && persistChanges) {
        const [chat] = await db
          .select()
          .from(copilotChats)
          .where(eq(copilotChats.id, actualChatId))
          .limit(1)

        const existingMessages = chat ? (Array.isArray(chat.messages) ? chat.messages : []) : []

        const newMessages = [
          ...existingMessages,
          {
            id: userMessageId,
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            content: result.content,
            timestamp: new Date().toISOString(),
            toolCalls: Object.entries(toolResults).map(([id, r]) => ({
              id,
              success: r.success,
            })),
          },
        ]

        await db
          .update(copilotChats)
          .set({ messages: newMessages, updatedAt: new Date() })
          .where(eq(copilotChats.id, actualChatId))
      }

      const duration = Date.now() - startTime
      logger.info(`[${tracker.requestId}] Headless copilot complete`, {
        duration,
        contentLength: result.content?.length || 0,
        toolCallsExecuted: Object.keys(toolResults).length,
      })

      return NextResponse.json({
        success: true,
        streamId,
        chatId: actualChatId,
        content: result.content,
        toolResults,
        duration,
      })
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        await errorStream(streamId, 'Request timed out')
        return NextResponse.json({ error: 'Request timed out' }, { status: 504 })
      }

      throw error
    }
  } catch (error) {
    logger.error(`[${tracker.requestId}] Headless copilot error`, { error })

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}

