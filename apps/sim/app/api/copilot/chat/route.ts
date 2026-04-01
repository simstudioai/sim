import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { type ChatLoadResult, resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/copilot/chat/persisted-message'
import {
  processContextsServer,
  resolveActiveResourceContext,
} from '@/lib/copilot/chat/process-contents'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/constants'
import {
  createBadRequestResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/copilot/request/lifecycle/start'
import {
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { getWorkflowById, resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { ChatContext } from '@/stores/panel'

export const maxDuration = 3600

const logger = createLogger('CopilotChatAPI')

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const ResourceAttachmentSchema = z.object({
  type: z.enum(['workflow', 'table', 'file', 'knowledgebase']),
  id: z.string().min(1),
  title: z.string().optional(),
  active: z.boolean().optional(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  workflowName: z.string().optional(),
  model: z.string().optional().default('claude-opus-4-6'),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  prefetch: z.boolean().optional(),
  createNewChat: z.boolean().optional().default(false),
  implicitFeedback: z.string().optional(),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  resourceAttachments: z.array(ResourceAttachmentSchema).optional(),
  provider: z.string().optional(),
  contexts: z
    .array(
      z.object({
        kind: z.enum([
          'past_chat',
          'workflow',
          'current_workflow',
          'blocks',
          'logs',
          'workflow_block',
          'knowledge',
          'templates',
          'docs',
          'table',
          'file',
        ]),
        label: z.string(),
        chatId: z.string().optional(),
        workflowId: z.string().optional(),
        knowledgeId: z.string().optional(),
        blockId: z.string().optional(),
        blockIds: z.array(z.string()).optional(),
        templateId: z.string().optional(),
        executionId: z.string().optional(),
        tableId: z.string().optional(),
        fileId: z.string().optional(),
      })
    )
    .optional(),
  commands: z.array(z.string()).optional(),
  userTimezone: z.string().optional(),
})

// ---------------------------------------------------------------------------
// POST /api/copilot/chat
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let actualChatId: string | undefined
  let chatStreamLockAcquired = false
  let userMessageIdToUse = ''

  try {
    // 1. Auth
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }
    const authenticatedUserId = session.user.id

    // 2. Parse & validate
    const body = await req.json()
    const {
      message,
      userMessageId,
      chatId,
      workflowId: providedWorkflowId,
      workspaceId: requestedWorkspaceId,
      workflowName,
      model,
      mode,
      prefetch,
      createNewChat,
      implicitFeedback,
      fileAttachments,
      resourceAttachments,
      provider,
      contexts,
      commands,
      userTimezone,
    } = ChatMessageSchema.parse(body)

    const normalizedContexts = Array.isArray(contexts)
      ? contexts.map((ctx) => {
          if (ctx.kind !== 'blocks') return ctx
          if (Array.isArray(ctx.blockIds) && ctx.blockIds.length > 0) return ctx
          if (ctx.blockId) return { ...ctx, blockIds: [ctx.blockId] }
          return ctx
        })
      : contexts

    // 3. Resolve workflow & workspace
    const resolved = await resolveWorkflowIdForUser(
      authenticatedUserId,
      providedWorkflowId,
      workflowName,
      requestedWorkspaceId
    )
    if (!resolved) {
      return createBadRequestResponse(
        'No workflows found. Create a workflow first or provide a valid workflowId.'
      )
    }
    const { workflowId, workflowName: workflowResolvedName } = resolved

    let resolvedWorkspaceId: string | undefined
    try {
      const wf = await getWorkflowById(workflowId)
      resolvedWorkspaceId = wf?.workspaceId ?? undefined
    } catch {
      logger.warn(`[${tracker.requestId}] Failed to resolve workspaceId from workflow`)
    }

    userMessageIdToUse = userMessageId || crypto.randomUUID()
    const selectedModel = model || 'claude-opus-4-6'

    logger.info(`[${tracker.requestId}] Received chat POST`, {
      workflowId,
      contextsCount: Array.isArray(normalizedContexts) ? normalizedContexts.length : 0,
    })

    // 4. Resolve or create chat
    let currentChat: ChatLoadResult['chat'] = null
    let conversationHistory: unknown[] = []
    actualChatId = chatId

    if (chatId || createNewChat) {
      const chatResult = await resolveOrCreateChat({
        chatId,
        userId: authenticatedUserId,
        workflowId,
        model: selectedModel,
      })
      currentChat = chatResult.chat
      actualChatId = chatResult.chatId || chatId
      conversationHistory = Array.isArray(chatResult.conversationHistory)
        ? chatResult.conversationHistory
        : []

      if (chatId && !currentChat) {
        return createBadRequestResponse('Chat not found')
      }
    }

    if (actualChatId) {
      chatStreamLockAcquired = await acquirePendingChatStream(actualChatId, userMessageIdToUse)
      if (!chatStreamLockAcquired) {
        const activeStreamId = await getPendingChatStreamId(actualChatId)
        return NextResponse.json(
          {
            error: 'A response is already in progress for this chat.',
            ...(activeStreamId ? { activeStreamId } : {}),
          },
          { status: 409 }
        )
      }
    }

    // 5. Process contexts
    let agentContexts: Array<{ type: string; content: string }> = []

    if (Array.isArray(normalizedContexts) && normalizedContexts.length > 0) {
      try {
        const processed = await processContextsServer(
          normalizedContexts as ChatContext[],
          authenticatedUserId,
          message,
          resolvedWorkspaceId,
          actualChatId
        )
        agentContexts = processed
        logger.info(`[${tracker.requestId}] Contexts processed`, {
          processedCount: agentContexts.length,
          kinds: agentContexts.map((c) => c.type),
        })
        if (agentContexts.length === 0) {
          logger.warn(
            `[${tracker.requestId}] Contexts provided but none processed. Check executionId for logs contexts.`
          )
        }
      } catch (e) {
        logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
      }
    }

    // 5b. Process resource attachments
    if (
      Array.isArray(resourceAttachments) &&
      resourceAttachments.length > 0 &&
      resolvedWorkspaceId
    ) {
      const results = await Promise.allSettled(
        resourceAttachments.map(async (r) => {
          const ctx = await resolveActiveResourceContext(
            r.type,
            r.id,
            resolvedWorkspaceId!,
            authenticatedUserId,
            actualChatId
          )
          if (!ctx) return null
          return { ...ctx, tag: r.active ? '@active_tab' : '@open_tab' }
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          agentContexts.push(result.value)
        } else if (result.status === 'rejected') {
          logger.error(
            `[${tracker.requestId}] Failed to resolve resource attachment`,
            result.reason
          )
        }
      }
    }

    // 6. Build copilot request payload
    const userPermission = resolvedWorkspaceId
      ? await getUserEntityPermissions(authenticatedUserId, 'workspace', resolvedWorkspaceId).catch(
          (err) => {
            logger.warn('Failed to load user permissions', {
              error: err instanceof Error ? err.message : String(err),
            })
            return null
          }
        )
      : null

    const requestPayload = await buildCopilotRequestPayload(
      {
        message,
        workflowId: workflowId || '',
        workflowName: workflowResolvedName,
        workspaceId: resolvedWorkspaceId,
        userId: authenticatedUserId,
        userMessageId: userMessageIdToUse,
        mode,
        model: selectedModel,
        provider,
        contexts: agentContexts,
        fileAttachments,
        commands,
        chatId: actualChatId,
        prefetch,
        implicitFeedback,
        userPermission: userPermission ?? undefined,
        userTimezone,
      },
      { selectedModel }
    )

    logger.info(`[${tracker.requestId}] About to call Sim Agent`, {
      contextCount: agentContexts.length,
      hasFileAttachments: Array.isArray(requestPayload.fileAttachments),
      messageLength: message.length,
      mode,
    })

    // 7. Persist user message
    if (actualChatId) {
      const userMsg = buildPersistedUserMessage({
        id: userMessageIdToUse,
        content: message,
        fileAttachments,
        contexts: normalizedContexts,
      })

      const [updated] = await db
        .update(copilotChats)
        .set({
          messages: sql`${copilotChats.messages} || ${JSON.stringify([userMsg])}::jsonb`,
          conversationId: userMessageIdToUse,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, actualChatId))
        .returning({ messages: copilotChats.messages })

      if (updated) {
        const freshMessages: Record<string, unknown>[] = Array.isArray(updated.messages)
          ? updated.messages
          : []
        conversationHistory = freshMessages.filter(
          (m: Record<string, unknown>) => m.id !== userMessageIdToUse
        )
      }
    }

    // 8. Create SSE stream with onComplete for assistant message persistence
    const executionId = crypto.randomUUID()
    const runId = crypto.randomUUID()

    const sseStream = createSSEStream({
      requestPayload,
      userId: authenticatedUserId,
      streamId: userMessageIdToUse,
      executionId,
      runId,
      chatId: actualChatId,
      currentChat,
      isNewChat: conversationHistory.length === 0,
      message,
      titleModel: selectedModel,
      titleProvider: provider,
      requestId: tracker.requestId,
      workspaceId: resolvedWorkspaceId,
      orchestrateOptions: {
        userId: authenticatedUserId,
        workflowId,
        chatId: actualChatId,
        executionId,
        runId,
        goRoute: '/api/copilot',
        autoExecuteTools: true,
        interactive: true,
        onComplete: buildOnComplete(actualChatId, userMessageIdToUse, tracker.requestId),
      },
    })

    return new Response(sseStream, { headers: SSE_RESPONSE_HEADERS })
  } catch (error) {
    if (chatStreamLockAcquired && actualChatId && userMessageIdToUse) {
      await releasePendingChatStream(actualChatId, userMessageIdToUse)
    }
    const duration = tracker.getDuration()

    if (error instanceof z.ZodError) {
      logger.error(`[${tracker.requestId}] Validation error:`, { duration, errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling copilot chat:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// onComplete: persist assistant message after streaming finishes
// ---------------------------------------------------------------------------

function buildOnComplete(
  chatId: string | undefined,
  userMessageId: string,
  requestId: string
): (result: OrchestratorResult) => Promise<void> {
  return async (result) => {
    if (!chatId || !result.success) return

    const assistantMessage = buildPersistedAssistantMessage(result, result.requestId)

    try {
      const [row] = await db
        .select({ messages: copilotChats.messages })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
        .limit(1)

      const msgs: Record<string, unknown>[] = Array.isArray(row?.messages) ? row.messages : []
      const userIdx = msgs.findIndex((m: Record<string, unknown>) => m.id === userMessageId)
      const alreadyHasResponse =
        userIdx >= 0 &&
        userIdx + 1 < msgs.length &&
        (msgs[userIdx + 1] as Record<string, unknown>)?.role === 'assistant'

      if (!alreadyHasResponse) {
        await db
          .update(copilotChats)
          .set({
            messages: sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`,
            conversationId: sql`CASE WHEN ${copilotChats.conversationId} = ${userMessageId} THEN NULL ELSE ${copilotChats.conversationId} END`,
            updatedAt: new Date(),
          })
          .where(eq(copilotChats.id, chatId))
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist chat messages`, {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// GET handler (read-only queries, extracted to queries.ts)
// ---------------------------------------------------------------------------

export { GET } from './queries'
