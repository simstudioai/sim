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
import { finalizeAssistantTurn } from '@/lib/copilot/chat/terminal-state'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
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
import type { ExecutionContext, OrchestratorResult } from '@/lib/copilot/request/types'
import { persistChatResources } from '@/lib/copilot/resources/persistence'
import { taskPubSub } from '@/lib/copilot/tasks'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getWorkflowById, resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { ChatContext } from '@/stores/panel'

export const maxDuration = 3600

const logger = createLogger('UnifiedChatAPI')
const DEFAULT_MODEL = 'claude-opus-4-6'

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const ResourceAttachmentSchema = z.object({
  type: z.enum(['workflow', 'table', 'file', 'knowledgebase', 'folder']),
  id: z.string().min(1),
  title: z.string().optional(),
  active: z.boolean().optional(),
})

const GENERIC_RESOURCE_TITLE: Record<z.infer<typeof ResourceAttachmentSchema>['type'], string> = {
  workflow: 'Workflow',
  table: 'Table',
  file: 'File',
  knowledgebase: 'Knowledge Base',
  folder: 'Folder',
}

const ChatContextSchema = z.object({
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
    'folder',
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
  folderId: z.string().optional(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  workflowName: z.string().optional(),
  model: z.string().optional().default(DEFAULT_MODEL),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  prefetch: z.boolean().optional(),
  createNewChat: z.boolean().optional().default(false),
  implicitFeedback: z.string().optional(),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  resourceAttachments: z.array(ResourceAttachmentSchema).optional(),
  provider: z.string().optional(),
  contexts: z.array(ChatContextSchema).optional(),
  commands: z.array(z.string()).optional(),
  userTimezone: z.string().optional(),
})

type UnifiedChatRequest = z.infer<typeof ChatMessageSchema>
type UnifiedChatBranch =
  | {
      kind: 'workflow'
      workflowId: string
      workflowName?: string
      workspaceId?: string
      selectedModel: string
      mode: UnifiedChatRequest['mode']
      provider?: string
      goRoute: '/api/copilot'
      titleModel: string
      titleProvider?: string
      notifyWorkspaceStatus: false
      buildPayload: (params: {
        message: string
        userId: string
        userMessageId: string
        chatId?: string
        contexts: Array<{ type: string; content: string }>
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        userTimezone?: string
        workflowId: string
        workflowName?: string
        workspaceId?: string
        mode: UnifiedChatRequest['mode']
        provider?: string
        commands?: string[]
        prefetch?: boolean
        implicitFeedback?: string
      }) => Promise<Record<string, unknown>>
      buildExecutionContext: (params: {
        userId: string
        chatId?: string
        userTimezone?: string
        messageId: string
      }) => Promise<ExecutionContext>
    }
  | {
      kind: 'workspace'
      workspaceId: string
      goRoute: '/api/mothership'
      titleModel: string
      titleProvider?: undefined
      notifyWorkspaceStatus: true
      buildPayload: (params: {
        message: string
        userId: string
        userMessageId: string
        chatId?: string
        contexts: Array<{ type: string; content: string }>
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        userTimezone?: string
        workspaceContext?: string
      }) => Promise<Record<string, unknown>>
      buildExecutionContext: (params: {
        userId: string
        chatId?: string
        userTimezone?: string
        messageId: string
      }) => Promise<ExecutionContext>
    }

function normalizeContexts(contexts: UnifiedChatRequest['contexts']) {
  if (!Array.isArray(contexts)) {
    return contexts
  }

  return contexts.map((ctx) => {
    if (ctx.kind !== 'blocks') return ctx
    if (Array.isArray(ctx.blockIds) && ctx.blockIds.length > 0) return ctx
    if (ctx.blockId) return { ...ctx, blockIds: [ctx.blockId] }
    return ctx
  })
}

async function resolveAgentContexts(params: {
  contexts?: UnifiedChatRequest['contexts']
  resourceAttachments?: UnifiedChatRequest['resourceAttachments']
  userId: string
  message: string
  workspaceId?: string
  chatId?: string
  requestId: string
}): Promise<Array<{ type: string; content: string }>> {
  const { contexts, resourceAttachments, userId, message, workspaceId, chatId, requestId } = params

  let agentContexts: Array<{ type: string; content: string }> = []

  if (Array.isArray(contexts) && contexts.length > 0) {
    try {
      agentContexts = await processContextsServer(
        contexts as ChatContext[],
        userId,
        message,
        workspaceId,
        chatId
      )
    } catch (error) {
      logger.error(`[${requestId}] Failed to process contexts`, error)
    }
  }

  if (Array.isArray(resourceAttachments) && resourceAttachments.length > 0 && workspaceId) {
    const results = await Promise.allSettled(
      resourceAttachments.map(async (resource) => {
        const ctx = await resolveActiveResourceContext(
          resource.type,
          resource.id,
          workspaceId,
          userId,
          chatId
        )
        if (!ctx) return null
        return { ...ctx, tag: resource.active ? '@active_tab' : '@open_tab' }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        agentContexts.push(result.value)
      } else if (result.status === 'rejected') {
        logger.error(`[${requestId}] Failed to resolve resource attachment`, result.reason)
      }
    }
  }

  return agentContexts
}

async function persistUserMessage(params: {
  chatId?: string
  userMessageId: string
  message: string
  fileAttachments?: UnifiedChatRequest['fileAttachments']
  contexts?: UnifiedChatRequest['contexts']
  workspaceId?: string
  notifyWorkspaceStatus: boolean
}): Promise<unknown[] | undefined> {
  const {
    chatId,
    userMessageId,
    message,
    fileAttachments,
    contexts,
    workspaceId,
    notifyWorkspaceStatus,
  } = params
  if (!chatId) return undefined

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
    .where(eq(copilotChats.id, chatId))
    .returning({ messages: copilotChats.messages })

  if (notifyWorkspaceStatus && updated && workspaceId) {
    taskPubSub?.publishStatusChanged({ workspaceId, chatId, type: 'started' })
  }

  return Array.isArray(updated?.messages) ? updated.messages : undefined
}

async function buildInitialExecutionContext(params: {
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  messageId: string
  userTimezone?: string
  requestMode: string
}): Promise<ExecutionContext> {
  const { userId, workflowId, workspaceId, chatId, messageId, userTimezone, requestMode } = params

  if (workflowId && !workspaceId) {
    const context = await prepareExecutionContext(userId, workflowId, chatId)
    return {
      ...context,
      messageId,
      userTimezone,
      requestMode,
      copilotToolExecution: true,
    }
  }

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
  return {
    userId,
    workflowId: workflowId ?? '',
    workspaceId,
    chatId,
    decryptedEnvVars,
    messageId,
    userTimezone,
    requestMode,
    copilotToolExecution: true,
  }
}

function buildOnComplete(params: {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyWorkspaceStatus: boolean
}) {
  const { chatId, userMessageId, requestId, workspaceId, notifyWorkspaceStatus } = params

  return async (result: OrchestratorResult) => {
    if (!chatId) return

    try {
      await finalizeAssistantTurn({
        chatId,
        userMessageId,
        ...(result.success
          ? { assistantMessage: buildPersistedAssistantMessage(result, requestId) }
          : {}),
      })

      if (notifyWorkspaceStatus && workspaceId) {
        taskPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist chat messages`, {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

function buildOnError(params: {
  chatId?: string
  userMessageId: string
  requestId: string
  workspaceId?: string
  notifyWorkspaceStatus: boolean
}) {
  const { chatId, userMessageId, requestId, workspaceId, notifyWorkspaceStatus } = params

  return async () => {
    if (!chatId) return

    try {
      await finalizeAssistantTurn({ chatId, userMessageId })

      if (notifyWorkspaceStatus && workspaceId) {
        taskPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to finalize errored chat stream`, {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

async function resolveBranch(params: {
  authenticatedUserId: string
  workflowId?: string
  workflowName?: string
  workspaceId?: string
  model?: string
  mode?: UnifiedChatRequest['mode']
  provider?: string
}): Promise<UnifiedChatBranch | NextResponse> {
  const {
    authenticatedUserId,
    workflowId: providedWorkflowId,
    workflowName,
    workspaceId: requestedWorkspaceId,
    model,
    mode,
    provider,
  } = params

  if (providedWorkflowId || workflowName) {
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

    const resolvedWorkflowId = resolved.workflowId
    let resolvedWorkspaceId = requestedWorkspaceId
    if (!resolvedWorkspaceId) {
      try {
        const workflow = await getWorkflowById(resolvedWorkflowId)
        resolvedWorkspaceId = workflow?.workspaceId ?? undefined
      } catch {
        // best effort; downstream calls can still proceed
      }
    }

    const selectedModel = model || DEFAULT_MODEL
    return {
      kind: 'workflow',
      workflowId: resolvedWorkflowId,
      workflowName: resolved.workflowName,
      workspaceId: resolvedWorkspaceId,
      selectedModel,
      mode: mode ?? 'agent',
      provider,
      goRoute: '/api/copilot',
      titleModel: selectedModel,
      titleProvider: provider,
      notifyWorkspaceStatus: false,
      buildPayload: async (payloadParams) =>
        buildCopilotRequestPayload(
          {
            message: payloadParams.message,
            workflowId: payloadParams.workflowId,
            workflowName: payloadParams.workflowName,
            workspaceId: payloadParams.workspaceId,
            userId: payloadParams.userId,
            userMessageId: payloadParams.userMessageId,
            mode: payloadParams.mode ?? 'agent',
            model: selectedModel,
            provider: payloadParams.provider,
            contexts: payloadParams.contexts,
            fileAttachments: payloadParams.fileAttachments,
            commands: payloadParams.commands,
            chatId: payloadParams.chatId,
            prefetch: payloadParams.prefetch,
            implicitFeedback: payloadParams.implicitFeedback,
            userPermission: payloadParams.userPermission,
            userTimezone: payloadParams.userTimezone,
          },
          { selectedModel }
        ),
      buildExecutionContext: async ({ userId, chatId, userTimezone, messageId }) =>
        buildInitialExecutionContext({
          userId,
          workflowId: resolvedWorkflowId,
          workspaceId: resolvedWorkspaceId,
          chatId,
          messageId,
          userTimezone,
          requestMode: mode ?? 'agent',
        }),
    }
  }

  if (!requestedWorkspaceId) {
    return createBadRequestResponse('workspaceId is required when workflowId is not provided')
  }

  return {
    kind: 'workspace',
    workspaceId: requestedWorkspaceId,
    goRoute: '/api/mothership',
    titleModel: DEFAULT_MODEL,
    notifyWorkspaceStatus: true,
    buildPayload: async (payloadParams) =>
      buildCopilotRequestPayload(
        {
          message: payloadParams.message,
          workspaceId: requestedWorkspaceId,
          userId: payloadParams.userId,
          userMessageId: payloadParams.userMessageId,
          mode: 'agent',
          model: '',
          contexts: payloadParams.contexts,
          fileAttachments: payloadParams.fileAttachments,
          chatId: payloadParams.chatId,
          workspaceContext: payloadParams.workspaceContext,
          userPermission: payloadParams.userPermission,
          userTimezone: payloadParams.userTimezone,
        },
        { selectedModel: '' }
      ),
    buildExecutionContext: async ({ userId, chatId, userTimezone, messageId }) =>
      buildInitialExecutionContext({
        userId,
        workspaceId: requestedWorkspaceId,
        chatId,
        messageId,
        userTimezone,
        requestMode: 'agent',
      }),
  }
}

export async function handleUnifiedChatPost(req: NextRequest) {
  const tracker = createRequestTracker(false)
  let actualChatId: string | undefined
  let userMessageId = ''
  let chatStreamLockAcquired = false

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }
    const authenticatedUserId = session.user.id

    const body = ChatMessageSchema.parse(await req.json())
    const normalizedContexts = normalizeContexts(body.contexts)
    userMessageId = body.userMessageId || crypto.randomUUID()

    const branch = await resolveBranch({
      authenticatedUserId,
      workflowId: body.workflowId,
      workflowName: body.workflowName,
      workspaceId: body.workspaceId,
      model: body.model,
      mode: body.mode,
      provider: body.provider,
    })
    if (branch instanceof NextResponse) {
      return branch
    }

    let currentChat: ChatLoadResult['chat'] = null
    let conversationHistory: unknown[] = []
    let chatIsNew = false
    actualChatId = body.chatId

    if (body.chatId || body.createNewChat) {
      const chatResult = await resolveOrCreateChat({
        chatId: body.chatId,
        userId: authenticatedUserId,
        ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
        workspaceId: branch.workspaceId,
        model: branch.titleModel,
        type: branch.kind === 'workflow' ? 'copilot' : 'mothership',
      })
      currentChat = chatResult.chat
      actualChatId = chatResult.chatId || body.chatId
      chatIsNew = chatResult.isNew
      conversationHistory = Array.isArray(chatResult.conversationHistory)
        ? chatResult.conversationHistory
        : []

      if (body.chatId && !currentChat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }
    }

    if (chatIsNew && actualChatId && body.resourceAttachments?.length) {
      await persistChatResources(
        actualChatId,
        body.resourceAttachments.map((r) => ({
          type: r.type,
          id: r.id,
          title: r.title ?? GENERIC_RESOURCE_TITLE[r.type],
        }))
      )
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
    }

    const workspaceId = branch.workspaceId
    const userPermissionPromise = workspaceId
      ? getUserEntityPermissions(authenticatedUserId, 'workspace', workspaceId).catch((error) => {
          logger.warn('Failed to load user permissions', {
            error: error instanceof Error ? error.message : String(error),
            workspaceId,
          })
          return null
        })
      : Promise.resolve(null)
    const workspaceContextPromise =
      branch.kind === 'workspace'
        ? generateWorkspaceContext(branch.workspaceId, authenticatedUserId)
        : Promise.resolve(undefined)
    const agentContextsPromise = resolveAgentContexts({
      contexts: normalizedContexts,
      resourceAttachments: body.resourceAttachments,
      userId: authenticatedUserId,
      message: body.message,
      workspaceId,
      chatId: actualChatId,
      requestId: tracker.requestId,
    })
    const persistedMessagesPromise = persistUserMessage({
      chatId: actualChatId,
      userMessageId,
      message: body.message,
      fileAttachments: body.fileAttachments,
      contexts: normalizedContexts,
      workspaceId,
      notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
    })
    const executionContextPromise = branch.buildExecutionContext({
      userId: authenticatedUserId,
      chatId: actualChatId,
      userTimezone: body.userTimezone,
      messageId: userMessageId,
    })

    const [agentContexts, userPermission, workspaceContext, persistedMessages, executionContext] =
      await Promise.all([
        agentContextsPromise,
        userPermissionPromise,
        workspaceContextPromise,
        persistedMessagesPromise,
        executionContextPromise,
      ])

    if (persistedMessages) {
      conversationHistory = persistedMessages.filter((message) => {
        const record = message as Record<string, unknown>
        return record.id !== userMessageId
      })
    }

    const requestPayload =
      branch.kind === 'workflow'
        ? await branch.buildPayload({
            message: body.message,
            userId: authenticatedUserId,
            userMessageId,
            chatId: actualChatId,
            contexts: agentContexts,
            fileAttachments: body.fileAttachments,
            userPermission: userPermission ?? undefined,
            userTimezone: body.userTimezone,
            workflowId: branch.workflowId,
            workflowName: branch.workflowName,
            workspaceId: branch.workspaceId,
            mode: branch.mode,
            provider: branch.provider,
            commands: body.commands,
            prefetch: body.prefetch,
            implicitFeedback: body.implicitFeedback,
          })
        : await branch.buildPayload({
            message: body.message,
            userId: authenticatedUserId,
            userMessageId,
            chatId: actualChatId,
            contexts: agentContexts,
            fileAttachments: body.fileAttachments,
            userPermission: userPermission ?? undefined,
            userTimezone: body.userTimezone,
            workspaceContext,
          })

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
      message: body.message,
      titleModel: branch.titleModel,
      ...(branch.titleProvider ? { titleProvider: branch.titleProvider } : {}),
      requestId: tracker.requestId,
      workspaceId,
      orchestrateOptions: {
        userId: authenticatedUserId,
        ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
        ...(branch.kind === 'workspace' ? { workspaceId: branch.workspaceId } : {}),
        chatId: actualChatId,
        executionId,
        runId,
        goRoute: branch.goRoute,
        autoExecuteTools: true,
        interactive: true,
        executionContext,
        onComplete: buildOnComplete({
          chatId: actualChatId,
          userMessageId,
          requestId: tracker.requestId,
          workspaceId,
          notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
        }),
        onError: buildOnError({
          chatId: actualChatId,
          userMessageId,
          requestId: tracker.requestId,
          workspaceId,
          notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
        }),
      },
    })

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
  } catch (error) {
    if (chatStreamLockAcquired && actualChatId && userMessageId) {
      await releasePendingChatStream(actualChatId, userMessageId)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling unified chat request`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
