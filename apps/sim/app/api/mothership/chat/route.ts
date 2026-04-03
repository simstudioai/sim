import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/copilot/chat/persisted-message'
import {
  processContextsServer,
  resolveActiveResourceContext,
} from '@/lib/copilot/chat/process-contents'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import { createRequestTracker, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/copilot/request/lifecycle/start'
import {
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/copilot/request/session'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { taskPubSub } from '@/lib/copilot/tasks'
import {
  assertActiveWorkspaceAccess,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export const maxDuration = 3600

const logger = createLogger('MothershipChatAPI')

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
  active: z.boolean().optional(),
})

const MothershipMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userMessageId: z.string().optional(),
  chatId: z.string().optional(),
  createNewChat: z.boolean().optional().default(false),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  userTimezone: z.string().optional(),
  resourceAttachments: z.array(ResourceAttachmentSchema).optional(),
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
})

/**
 * POST /api/mothership/chat
 * Workspace-scoped chat — no workflowId, proxies to Go /api/mothership.
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let lockChatId: string | undefined
  let lockStreamId = ''
  let chatStreamLockAcquired = false

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const authenticatedUserId = session.user.id
    const body = await req.json()
    const {
      message,
      workspaceId,
      userMessageId: providedMessageId,
      chatId,
      createNewChat,
      fileAttachments,
      contexts,
      resourceAttachments,
      userTimezone,
    } = MothershipMessageSchema.parse(body)

    const userMessageId = providedMessageId || crypto.randomUUID()
    lockStreamId = userMessageId

    // Phase 1: workspace access + chat resolution in parallel
    const [accessResult, chatResult] = await Promise.allSettled([
      assertActiveWorkspaceAccess(workspaceId, authenticatedUserId),
      chatId || createNewChat
        ? resolveOrCreateChat({
            chatId,
            userId: authenticatedUserId,
            workspaceId,
            model: 'claude-opus-4-6',
            type: 'mothership',
          })
        : null,
    ])

    if (accessResult.status === 'rejected') {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 403 })
    }

    let currentChat: any = null
    let conversationHistory: any[] = []
    let actualChatId = chatId

    if (chatResult.status === 'fulfilled' && chatResult.value) {
      const resolved = chatResult.value
      currentChat = resolved.chat
      actualChatId = resolved.chatId || chatId
      conversationHistory = Array.isArray(resolved.conversationHistory)
        ? resolved.conversationHistory
        : []

      if (chatId && !currentChat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }
    }

    if (actualChatId) {
      chatStreamLockAcquired = await acquirePendingChatStream(actualChatId, userMessageId)
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
      lockChatId = actualChatId
    }

    // Phase 2: contexts + workspace context + user message persistence in parallel
    const contextPromise = (async () => {
      let agentCtxs: Array<{ type: string; content: string }> = []
      if (Array.isArray(contexts) && contexts.length > 0) {
        try {
          agentCtxs = await processContextsServer(
            contexts as any,
            authenticatedUserId,
            message,
            workspaceId,
            actualChatId
          )
        } catch (e) {
          logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
        }
      }
      if (Array.isArray(resourceAttachments) && resourceAttachments.length > 0) {
        const results = await Promise.allSettled(
          resourceAttachments.map(async (r) => {
            const ctx = await resolveActiveResourceContext(
              r.type,
              r.id,
              workspaceId,
              authenticatedUserId,
              actualChatId
            )
            if (!ctx) return null
            return { ...ctx, tag: r.active ? '@active_tab' : '@open_tab' }
          })
        )
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            agentCtxs.push(result.value)
          } else if (result.status === 'rejected') {
            logger.error(
              `[${tracker.requestId}] Failed to resolve resource attachment`,
              result.reason
            )
          }
        }
      }
      return agentCtxs
    })()

    const userMsgPromise = (async () => {
      if (!actualChatId) return
      const userMsg = buildPersistedUserMessage({
        id: userMessageId,
        content: message,
        fileAttachments,
        contexts,
      })
      const [updated] = await db
        .update(copilotChats)
        .set({
          messages: sql`${copilotChats.messages} || ${JSON.stringify([userMsg])}::jsonb`,
          conversationId: userMessageId,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, actualChatId))
        .returning({ messages: copilotChats.messages })

      if (updated) {
        const freshMessages: any[] = Array.isArray(updated.messages) ? updated.messages : []
        conversationHistory = freshMessages.filter((m: any) => m.id !== userMessageId)
        taskPubSub?.publishStatusChanged({ workspaceId, chatId: actualChatId, type: 'started' })
      }
    })()

    const [agentContexts, [workspaceContext, userPermission]] = await Promise.all([
      contextPromise,
      Promise.all([
        generateWorkspaceContext(workspaceId, authenticatedUserId),
        getUserEntityPermissions(authenticatedUserId, 'workspace', workspaceId).catch(() => null),
      ]),
      userMsgPromise,
    ])

    const requestPayload = await buildCopilotRequestPayload(
      {
        message,
        workspaceId,
        userId: authenticatedUserId,
        userMessageId,
        mode: 'agent',
        model: '',
        contexts: agentContexts,
        fileAttachments,
        chatId: actualChatId,
        userPermission: userPermission ?? undefined,
        workspaceContext,
        userTimezone,
      },
      { selectedModel: '' }
    )

    const executionId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const stream = createSSEStream({
      requestPayload,
      userId: authenticatedUserId,
      streamId: userMessageId,
      executionId,
      runId,
      chatId: actualChatId,
      currentChat,
      isNewChat: conversationHistory.length === 0,
      message,
      titleModel: 'claude-opus-4-6',
      requestId: tracker.requestId,
      workspaceId,
      orchestrateOptions: {
        userId: authenticatedUserId,
        workspaceId,
        chatId: actualChatId,
        executionId,
        runId,
        goRoute: '/api/mothership',
        autoExecuteTools: true,
        interactive: true,
        onComplete: async (result: OrchestratorResult) => {
          if (!actualChatId) return
          if (!result.success) return

          const assistantMessage = buildPersistedAssistantMessage(result, result.requestId)

          try {
            const [row] = await db
              .select({ messages: copilotChats.messages })
              .from(copilotChats)
              .where(eq(copilotChats.id, actualChatId))
              .limit(1)

            const msgs: any[] = Array.isArray(row?.messages) ? row.messages : []
            const userIdx = msgs.findIndex((m: any) => m.id === userMessageId)
            const alreadyHasResponse =
              userIdx >= 0 &&
              userIdx + 1 < msgs.length &&
              (msgs[userIdx + 1] as any)?.role === 'assistant'

            if (!alreadyHasResponse) {
              await db
                .update(copilotChats)
                .set({
                  messages: sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`,
                  conversationId: sql`CASE WHEN ${copilotChats.conversationId} = ${userMessageId} THEN NULL ELSE ${copilotChats.conversationId} END`,
                  updatedAt: new Date(),
                })
                .where(eq(copilotChats.id, actualChatId))

              taskPubSub?.publishStatusChanged({
                workspaceId,
                chatId: actualChatId,
                type: 'completed',
              })
            }
          } catch (error) {
            logger.error(`[${tracker.requestId}] Failed to persist chat messages`, {
              chatId: actualChatId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },
    })

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
  } catch (error) {
    if (chatStreamLockAcquired && lockChatId && lockStreamId) {
      await releasePendingChatStream(lockChatId, lockStreamId)
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling mothership chat:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
