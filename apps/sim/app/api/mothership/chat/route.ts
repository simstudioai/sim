import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat-payload'
import {
  acquirePendingChatStream,
  createSSEStream,
  SSE_RESPONSE_HEADERS,
} from '@/lib/copilot/chat-streaming'
import type { OrchestratorResult } from '@/lib/copilot/orchestrator/types'
import { processContextsServer, resolveActiveResourceContext } from '@/lib/copilot/process-contents'
import { createRequestTracker, createUnauthorizedResponse } from '@/lib/copilot/request-helpers'
import { taskPubSub } from '@/lib/copilot/task-events'
import { generateWorkspaceContext } from '@/lib/copilot/workspace-context'
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
  title: z.string().optional(),
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

    try {
      await assertActiveWorkspaceAccess(workspaceId, authenticatedUserId)
    } catch {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 403 })
    }

    let currentChat: any = null
    let conversationHistory: any[] = []
    let actualChatId = chatId

    if (chatId || createNewChat) {
      const chatResult = await resolveOrCreateChat({
        chatId,
        userId: authenticatedUserId,
        workspaceId,
        model: 'claude-opus-4-6',
        type: 'mothership',
      })
      currentChat = chatResult.chat
      actualChatId = chatResult.chatId || chatId
      conversationHistory = Array.isArray(chatResult.conversationHistory)
        ? chatResult.conversationHistory
        : []

      if (chatId && !currentChat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }
    }

    let agentContexts: Array<{ type: string; content: string }> = []
    if (Array.isArray(contexts) && contexts.length > 0) {
      try {
        agentContexts = await processContextsServer(
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
          return {
            ...ctx,
            tag: r.active ? '@active_tab' : '@open_tab',
          }
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

    if (actualChatId) {
      const userMsg = {
        id: userMessageId,
        role: 'user' as const,
        content: message,
        timestamp: new Date().toISOString(),
        ...(fileAttachments &&
          fileAttachments.length > 0 && {
            fileAttachments: fileAttachments.map((f) => ({
              id: f.id,
              key: f.key,
              filename: f.filename,
              media_type: f.media_type,
              size: f.size,
            })),
          }),
        ...(contexts &&
          contexts.length > 0 && {
            contexts: contexts.map((c) => ({
              kind: c.kind,
              label: c.label,
              ...(c.workflowId && { workflowId: c.workflowId }),
              ...(c.knowledgeId && { knowledgeId: c.knowledgeId }),
              ...(c.tableId && { tableId: c.tableId }),
              ...(c.fileId && { fileId: c.fileId }),
            })),
          }),
      }

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
    }

    const [workspaceContext, userPermission] = await Promise.all([
      generateWorkspaceContext(workspaceId, authenticatedUserId),
      getUserEntityPermissions(authenticatedUserId, 'workspace', workspaceId).catch(() => null),
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

    if (actualChatId) {
      const acquired = await acquirePendingChatStream(actualChatId, userMessageId)
      if (!acquired) {
        return NextResponse.json(
          {
            error:
              'A response is already in progress for this chat. Wait for it to finish or use Stop.',
          },
          { status: 409 }
        )
      }
    }

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
      pendingChatStreamAlreadyRegistered: Boolean(actualChatId),
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

          const assistantMessage: Record<string, unknown> = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: result.content,
            timestamp: new Date().toISOString(),
            ...(result.requestId ? { requestId: result.requestId } : {}),
          }
          if (result.toolCalls.length > 0) {
            assistantMessage.toolCalls = result.toolCalls
          }
          if (result.contentBlocks.length > 0) {
            assistantMessage.contentBlocks = result.contentBlocks.map((block) => {
              const stored: Record<string, unknown> = { type: block.type }
              if (block.content) stored.content = block.content
              if (block.type === 'tool_call' && block.toolCall) {
                const state =
                  block.toolCall.result?.success !== undefined
                    ? block.toolCall.result.success
                      ? 'success'
                      : 'error'
                    : block.toolCall.status
                const isSubagentTool = !!block.calledBy
                const isNonTerminal =
                  state === 'cancelled' || state === 'pending' || state === 'executing'
                stored.toolCall = {
                  id: block.toolCall.id,
                  name: block.toolCall.name,
                  state,
                  ...(isSubagentTool && isNonTerminal ? {} : { result: block.toolCall.result }),
                  ...(isSubagentTool && isNonTerminal
                    ? {}
                    : block.toolCall.params
                      ? { params: block.toolCall.params }
                      : {}),
                  ...(block.calledBy ? { calledBy: block.calledBy } : {}),
                }
              }
              return stored
            })
          }

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
