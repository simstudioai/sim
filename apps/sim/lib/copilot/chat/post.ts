import { type Context as OtelContext, context as otelContextApi } from '@opentelemetry/api'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isZodError, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { type ChatLoadResult, resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  withStoppedContentBlock,
} from '@/lib/copilot/chat/persisted-message'
import {
  processContextsServer,
  resolveActiveResourceContext,
} from '@/lib/copilot/chat/process-contents'
import { finalizeAssistantTurn } from '@/lib/copilot/chat/terminal-state'
import { generateWorkspaceSnapshot } from '@/lib/copilot/chat/workspace-context'
import { chatPubSub } from '@/lib/copilot/chat-status'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/constants'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import {
  CopilotChatFinalizeOutcome,
  CopilotChatPersistOutcome,
  CopilotTransport,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import type { VfsSnapshotV1 } from '@/lib/copilot/generated/vfs-snapshot-v1'
import { createBadRequestResponse, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/copilot/request/lifecycle/start'
import { startCopilotOtelRoot, withCopilotSpan } from '@/lib/copilot/request/otel'
import {
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/copilot/request/session'
import type { ExecutionContext, OrchestratorResult } from '@/lib/copilot/request/types'
import { persistChatResources } from '@/lib/copilot/resources/persistence'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { captureServerEvent } from '@/lib/posthog/server'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import {
  getUserEntityPermissions,
  isWorkspaceAccessDeniedError,
  type PermissionType,
} from '@/lib/workspaces/permissions/utils'
import type { ChatContext } from '@/stores/panel'

export const maxDuration = 3600

const logger = createLogger('UnifiedChatAPI')
const DEFAULT_MODEL = 'claude-opus-4-8'

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
  path: z.string().optional(),
})

const ResourceAttachmentSchema = z.object({
  type: z.enum([
    'workflow',
    'table',
    'file',
    'knowledgebase',
    'folder',
    'filefolder',
    'task',
    'log',
    'scheduledtask',
    'generic',
    'browser',
  ]),
  id: z.string().min(1),
  title: z.string().optional(),
  active: z.boolean().optional(),
  /**
   * Live page URL for `browser` attachments. The agent browser lives in the
   * desktop app, so the client supplies its state — the server has nothing
   * to resolve it from.
   */
  url: z.string().max(2048).optional(),
})

const GENERIC_RESOURCE_TITLE: Record<z.infer<typeof ResourceAttachmentSchema>['type'], string> = {
  workflow: 'Workflow',
  table: 'Table',
  file: 'File',
  knowledgebase: 'Knowledge Base',
  folder: 'Folder',
  filefolder: 'File Folder',
  task: 'Task',
  log: 'Log',
  scheduledtask: 'Scheduled Task',
  generic: 'Resource',
  browser: 'Browser',
}

/** Ephemeral client-side panels are context-only: never persisted to the chat. */
function isPersistableAttachment(resource: z.infer<typeof ResourceAttachmentSchema>): boolean {
  return resource.type !== 'browser'
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
    'docs',
    'table',
    'file',
    'folder',
    'filefolder',
    'scheduledtask',
    'integration',
    'skill',
  ]),
  label: z.string(),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  knowledgeId: z.string().optional(),
  blockId: z.string().optional(),
  blockIds: z.array(z.string()).optional(),
  executionId: z.string().optional(),
  tableId: z.string().optional(),
  fileId: z.string().optional(),
  folderId: z.string().optional(),
  fileFolderId: z.string().optional(),
  skillId: z.string().optional(),
  scheduleId: z.string().optional(),
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
  desktopCapabilities: z
    .object({
      localFilesystem: z.boolean().optional(),
    })
    .optional(),
  browserCapable: z.boolean().optional(),
})

type UnifiedChatRequest = z.infer<typeof ChatMessageSchema>
type UnifiedChatBranch =
  | {
      kind: 'workflow'
      workflowId: string
      workflowName?: string
      workspaceId?: string
      effectiveModel: string
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
        contexts: Array<{ type: string; content: string; tag?: string; path?: string }>
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        entitlements?: string[]
        userTimezone?: string
        userMetadata?: { name?: string; email?: string; timezone?: string }
        workflowId: string
        workflowName?: string
        workspaceId?: string
        mode: UnifiedChatRequest['mode']
        provider?: string
        commands?: string[]
        prefetch?: boolean
        implicitFeedback?: string
        workspaceContext?: string
        vfs?: VfsSnapshotV1
        desktopLocalFilesystem?: boolean
        browserCapable?: boolean
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
      workspacePermission: PermissionType | null
      effectiveModel: string
      goRoute: '/api/mothership'
      titleModel: string
      titleProvider?: undefined
      notifyWorkspaceStatus: true
      buildPayload: (params: {
        message: string
        userId: string
        userMessageId: string
        chatId?: string
        contexts: Array<{ type: string; content: string; tag?: string; path?: string }>
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        entitlements?: string[]
        userTimezone?: string
        userMetadata?: { name?: string; email?: string; timezone?: string }
        workspaceContext?: string
        vfs?: VfsSnapshotV1
        desktopLocalFilesystem?: boolean
        browserCapable?: boolean
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
}): Promise<Array<{ type: string; content: string; tag?: string; path?: string }>> {
  const { contexts, resourceAttachments, userId, message, workspaceId, chatId, requestId } = params

  let agentContexts: Array<{ type: string; content: string; tag?: string; path?: string }> = []

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
        // The live browser panel resolves from the attachment itself: its
        // page state is client-held (the desktop app's embedded browser),
        // not a workspace entity the server could look up.
        if (resource.type === 'browser') {
          if (!resource.url) return null
          const title = resource.title?.trim()
          return {
            type: 'active_resource',
            tag: resource.active ? '@active_tab' : '@open_tab',
            content: `The user's live browser panel (driven by the browser subagent) is open on: ${
              title ? `"${title}" — ` : ''
            }${resource.url}`,
          }
        }
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
  /**
   * Root context for the mothership request. When present the persist
   * span is created explicitly under it, which avoids relying on
   * AsyncLocalStorage propagation — some upstream awaits (Next.js
   * framework frames, Turbopack-instrumented I/O) can swap the active
   * store out from under us in dev, which would otherwise leave this
   * span parented to the about-to-be-dropped Next.js HTTP span.
   */
  parentOtelContext?: OtelContext
}): Promise<void> {
  const {
    chatId,
    userMessageId,
    message,
    fileAttachments,
    contexts,
    workspaceId,
    notifyWorkspaceStatus,
    parentOtelContext,
  } = params
  if (!chatId) return

  return withCopilotSpan(
    TraceSpan.CopilotChatPersistUserMessage,
    {
      [TraceAttr.DbSystem]: 'postgresql',
      [TraceAttr.DbSqlTable]: 'copilot_chats',
      [TraceAttr.ChatId]: chatId,
      [TraceAttr.ChatUserMessageId]: userMessageId,
      [TraceAttr.ChatMessageBytes]: message.length,
      [TraceAttr.ChatFileAttachmentCount]: fileAttachments?.length ?? 0,
      [TraceAttr.ChatContextCount]: contexts?.length ?? 0,
      ...(workspaceId ? { [TraceAttr.WorkspaceId]: workspaceId } : {}),
    },
    async (span) => {
      const userMsg = buildPersistedUserMessage({
        id: userMessageId,
        content: message,
        fileAttachments,
        contexts,
      })

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(copilotChats)
          .set({
            conversationId: userMessageId,
            updatedAt: new Date(),
          })
          .where(eq(copilotChats.id, chatId))
          .returning({ model: copilotChats.model })

        if (!row) return null

        await appendCopilotChatMessages(
          chatId,
          [userMsg],
          { streamId: userMessageId, chatModel: row.model ?? null },
          tx
        )
        return row
      })

      span.setAttribute(
        TraceAttr.ChatPersistOutcome,
        updated ? CopilotChatPersistOutcome.Appended : CopilotChatPersistOutcome.ChatNotFound
      )

      if (notifyWorkspaceStatus && updated && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'started',
          streamId: userMessageId,
        })
      }
    },
    parentOtelContext
  )
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

  const [decryptedEnvVars, billingAttribution] = await Promise.all([
    getEffectiveDecryptedEnv(userId, workspaceId),
    workspaceId
      ? resolveBillingAttribution({ actorUserId: userId, workspaceId })
      : Promise.resolve(undefined),
  ])
  return {
    userId,
    workflowId: workflowId ?? '',
    workspaceId,
    chatId,
    decryptedEnvVars,
    billingAttribution,
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
  /**
   * Root agent span for this request. When present, the final
   * assistant message + invoked tool calls are recorded as
   * `gen_ai.output.messages` on it before persistence runs. Keeps
   * the Honeycomb Gen AI view complete across both the Sim root
   * span and the Go-side `llm.stream` spans.
   */
  otelRoot?: {
    setOutputMessages: (output: {
      assistantText?: string
      toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>
    }) => void
  }
}) {
  const { chatId, userMessageId, requestId, workspaceId, notifyWorkspaceStatus, otelRoot } = params

  return async (result: OrchestratorResult) => {
    if (otelRoot && result.success) {
      otelRoot.setOutputMessages({
        assistantText: result.content,
        toolCalls: result.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.params,
        })),
      })
    }

    if (!chatId) return

    try {
      if (result.cancelled) {
        const finalization = await finalizeAssistantTurn({
          chatId,
          userMessageId,
          assistantMessage: withStoppedContentBlock(
            buildPersistedAssistantMessage(result, requestId)
          ),
          streamMarkerPolicy: 'active-or-cleared',
        })
        const shouldPublishCompletion =
          finalization.updated ||
          finalization.outcome === CopilotChatFinalizeOutcome.AssistantAlreadyPersisted

        if (notifyWorkspaceStatus && workspaceId && shouldPublishCompletion) {
          chatPubSub?.publishStatusChanged({
            workspaceId,
            chatId,
            type: 'completed',
            streamId: userMessageId,
          })
        }
        return
      }

      // On a non-success terminal (e.g. a transient provider error like
      // "overloaded"), persist whatever streamed before the failure — same as
      // the cancelled path — instead of dropping the partial assistant output.
      const assistantMessage = buildPersistedAssistantMessage(result, requestId)
      const hasPartial =
        !!assistantMessage.content?.trim() || (assistantMessage.contentBlocks?.length ?? 0) > 0
      await finalizeAssistantTurn({
        chatId,
        userMessageId,
        ...(result.success || hasPartial ? { assistantMessage } : {}),
        // Match the cancelled path so the partial still persists if onError
        // raced ahead and already cleared the stream marker.
        ...(result.success ? {} : { streamMarkerPolicy: 'active-or-cleared' as const }),
      })

      if (notifyWorkspaceStatus && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
          streamId: userMessageId,
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist chat messages`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
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

  return async (_error: Error, result?: OrchestratorResult) => {
    if (!chatId) return

    try {
      // Persist whatever streamed before a thrown backend error, mirroring the
      // cancelled / non-success completion path, so the partial assistant turn
      // (text + tool calls + subagent work) survives the refetch instead of the
      // chat collapsing to an empty assistant row.
      const assistantMessage = result
        ? buildPersistedAssistantMessage(result, requestId)
        : undefined
      const hasPartial =
        !!assistantMessage?.content?.trim() || (assistantMessage?.contentBlocks?.length ?? 0) > 0
      await finalizeAssistantTurn({
        chatId,
        userMessageId,
        ...(hasPartial ? { assistantMessage } : {}),
        streamMarkerPolicy: 'active-or-cleared',
      })

      if (notifyWorkspaceStatus && workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId,
          chatId,
          type: 'completed',
          streamId: userMessageId,
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to finalize errored chat stream`, {
        chatId,
        error: getErrorMessage(error, 'Unknown error'),
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
    if (resolved.status !== 'resolved') {
      return createBadRequestResponse(resolved.message)
    }

    const resolvedWorkflowId = resolved.workflowId
    const resolvedWorkspaceId = resolved.workspaceId

    const selectedModel = model || DEFAULT_MODEL
    return {
      kind: 'workflow',
      workflowId: resolvedWorkflowId,
      workflowName: resolved.workflowName,
      workspaceId: resolvedWorkspaceId,
      effectiveModel: selectedModel,
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
            workspaceContext: payloadParams.workspaceContext,
            vfs: payloadParams.vfs,
            userPermission: payloadParams.userPermission,
            entitlements: payloadParams.entitlements,
            userTimezone: payloadParams.userTimezone,
            userMetadata: payloadParams.userMetadata,
            desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
            browserCapable: payloadParams.browserCapable,
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

  const workspacePermission = await getUserEntityPermissions(
    authenticatedUserId,
    'workspace',
    requestedWorkspaceId
  )

  if (workspacePermission === null) {
    return createBadRequestResponse('Workspace not found or access denied')
  }

  return {
    kind: 'workspace',
    workspaceId: requestedWorkspaceId,
    workspacePermission,
    effectiveModel: DEFAULT_MODEL,
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
          vfs: payloadParams.vfs,
          userPermission: payloadParams.userPermission,
          entitlements: payloadParams.entitlements,
          userTimezone: payloadParams.userTimezone,
          userMetadata: payloadParams.userMetadata,
          includeMothershipTools: true,
          desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
          browserCapable: payloadParams.browserCapable,
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
  let actualChatId: string | undefined
  let userMessageId = ''
  let chatStreamLockAcquired = false
  // Started once we've parsed the body (need userMessageId to stamp as
  // streamId). Every subsequent span (persistUserMessage,
  // createRunSegment, the whole SSE stream, etc.) nests under this
  // root via AsyncLocalStorage / explicit propagation, and the stream's
  // terminal code path calls finish() when the request actually ends.
  // Errors thrown from the handler before the stream starts are
  // finished here in the catch below.
  let otelRoot: ReturnType<typeof startCopilotOtelRoot> | undefined
  // Canonical logical ID; assigned from otelRoot.requestId (the OTel
  // trace ID) as soon as startCopilotOtelRoot runs. Empty only in the
  // narrow pre-otelRoot window where errors don't correlate anyway.
  let requestId = ''
  const executionId = generateId()
  const runId = generateId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }
    const authenticatedUserId = session.user.id
    const authenticatedUserEmail = session.user.email
    const authenticatedUserName =
      typeof session.user.name === 'string' ? session.user.name : undefined

    const body = ChatMessageSchema.parse(await req.json())
    const userMetadata = {
      ...(authenticatedUserName ? { name: authenticatedUserName } : {}),
      ...(authenticatedUserEmail ? { email: authenticatedUserEmail } : {}),
      ...(body.userTimezone ? { timezone: body.userTimezone } : {}),
    }
    const normalizedContexts = normalizeContexts(body.contexts) ?? []
    userMessageId = body.userMessageId || generateId()

    otelRoot = startCopilotOtelRoot({
      streamId: userMessageId,
      executionId,
      runId,
      transport: CopilotTransport.Stream,
      userMessagePreview: body.message,
    })
    if (otelRoot.requestId) {
      requestId = otelRoot.requestId
    }
    // Identity stamp — Go already stamps `user.id` on spans from the
    // validated API-key path, but Sim is the only side of the wire
    // that knows the human-facing email. Stamping both on the Sim
    // root (so they show up on `rootAttrs` in Tempo search) saves
    // the "turn user.id into a real person" round-trip to the DB
    // for every ad-hoc investigation.
    otelRoot.span.setAttribute(TraceAttr.UserId, authenticatedUserId)
    if (authenticatedUserEmail) {
      otelRoot.span.setAttribute(TraceAttr.UserEmail, authenticatedUserEmail)
    }
    // `setInputMessages` is internally gated on
    // OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT; safe to call.
    otelRoot.setInputMessages({ userMessage: body.message })

    // Wrap the rest of the handler so nested spans attach to the
    // root via AsyncLocalStorage (otherwise they orphan into new traces).
    const activeOtelRoot = otelRoot
    return await otelContextApi.with(activeOtelRoot.context, async () => {
      const branch = await withCopilotSpan(
        TraceSpan.CopilotChatResolveBranch,
        {
          [TraceAttr.WorkflowId]: body.workflowId ?? '',
          [TraceAttr.WorkspaceId]: body.workspaceId ?? '',
        },
        () =>
          resolveBranch({
            authenticatedUserId,
            workflowId: body.workflowId,
            workflowName: body.workflowName,
            workspaceId: body.workspaceId,
            model: body.model,
            mode: body.mode,
            provider: body.provider,
          }),
        activeOtelRoot.context
      )
      if (branch instanceof NextResponse) {
        // Non-actionable 4xx (400 bad-request from resolveBranch): stamp
        // outcome=error for dashboards but leave span status UNSET so
        // error alerts don't fire on normal validation rejections.
        activeOtelRoot.span.setAttribute(TraceAttr.HttpStatusCode, branch.status)
        activeOtelRoot.finish('error')
        return branch
      }

      let currentChat: ChatLoadResult['chat'] = null
      let conversationHistory: unknown[] = []
      let chatIsNew = false
      actualChatId = body.chatId

      if (body.chatId || body.createNewChat) {
        const chatResult = await withCopilotSpan(
          TraceSpan.CopilotChatResolveOrCreateChat,
          {
            [TraceAttr.ChatPreexisting]: !!body.chatId,
            [TraceAttr.CopilotChatIsNew]: !!body.createNewChat,
          },
          () =>
            resolveOrCreateChat({
              chatId: body.chatId,
              userId: authenticatedUserId,
              ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
              workspaceId: branch.workspaceId,
              model: branch.titleModel,
              type: branch.kind === 'workflow' ? 'copilot' : 'mothership',
            }),
          activeOtelRoot.context
        )
        currentChat = chatResult.chat
        actualChatId = chatResult.chatId || body.chatId
        chatIsNew = chatResult.isNew
        conversationHistory = Array.isArray(chatResult.conversationHistory)
          ? chatResult.conversationHistory
          : []

        if (body.chatId && !currentChat) {
          activeOtelRoot.span.setAttribute(TraceAttr.HttpStatusCode, 404)
          activeOtelRoot.finish('error')
          return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
        }
      }

      if (chatIsNew && actualChatId && body.resourceAttachments?.length) {
        const persistable = body.resourceAttachments.filter(isPersistableAttachment)
        if (persistable.length > 0) {
          await persistChatResources(
            actualChatId,
            persistable.map((r) => ({
              type: r.type,
              id: r.id,
              title: r.title ?? GENERIC_RESOURCE_TITLE[r.type],
            }))
          )
        }
      }

      let pendingStreamWaitMs = 0
      if (actualChatId) {
        const lockStart = Date.now()
        chatStreamLockAcquired = await acquirePendingChatStream(actualChatId, userMessageId)
        pendingStreamWaitMs = Date.now() - lockStart
        if (!chatStreamLockAcquired) {
          const activeStreamId = await getPendingChatStreamId(actualChatId)
          // 409 is in the actionable set (see `isActionableErrorStatus`);
          // pass a synthesized Error so the span escalates to ERROR status
          // and surfaces on pending-stream-collision dashboards.
          activeOtelRoot.span.setAttribute(TraceAttr.HttpStatusCode, 409)
          activeOtelRoot.finish(
            'error',
            new Error('A response is already in progress for this chat.')
          )
          return NextResponse.json(
            {
              error: 'A response is already in progress for this chat.',
              ...(activeStreamId ? { activeStreamId } : {}),
            },
            { status: 409 }
          )
        }
      }

      // Stamp request-shape metadata on the root `gen_ai.agent.execute`
      // span now that `branch`, attachment counts, and the pending-stream
      // wait are all known. This turns dashboard slicing by
      // `copilot.surface` / `copilot.mode` / `copilot.interrupted_prior_stream`
      // into a simple TraceQL filter.
      activeOtelRoot.setRequestShape({
        branchKind: branch.kind,
        mode: body.mode,
        model: branch.effectiveModel,
        provider: body.provider,
        createNewChat: body.createNewChat,
        prefetch: body.prefetch,
        fileAttachmentsCount: body.fileAttachments?.length ?? 0,
        resourceAttachmentsCount: body.resourceAttachments?.length ?? 0,
        contextsCount: normalizedContexts.length,
        commandsCount: body.commands?.length ?? 0,
        pendingStreamWaitMs,
      })

      const workspaceId = branch.workspaceId
      // The workspace branch already resolved this permission (and gated on it)
      // during branch resolution; reuse it instead of querying again.
      const userPermissionPromise =
        branch.kind === 'workspace'
          ? Promise.resolve(branch.workspacePermission)
          : workspaceId
            ? getUserEntityPermissions(authenticatedUserId, 'workspace', workspaceId).catch(
                (error) => {
                  logger.warn('Failed to load user permissions', {
                    error: getErrorMessage(error),
                    workspaceId,
                  })
                  return null
                }
              )
            : Promise.resolve(null)
      const entitlementsPromise = workspaceId
        ? computeWorkspaceEntitlements(workspaceId, authenticatedUserId)
        : Promise.resolve([])
      // Wrap the pre-LLM prep work in spans so the trace waterfall shows
      // where time is going between "request received" and "llm.stream
      // opens". Previously these ran bare under the root and inflated the
      // apparent "gap" before the model call. Each promise is its own
      // span; they run concurrently under Promise.all below.
      const workspaceContextPromise = workspaceId
        ? withCopilotSpan(
            TraceSpan.CopilotChatBuildWorkspaceContext,
            { [TraceAttr.WorkspaceId]: workspaceId },
            () => generateWorkspaceSnapshot(workspaceId, authenticatedUserId),
            activeOtelRoot.context
          )
        : Promise.resolve(undefined)
      const agentContextsPromise = withCopilotSpan(
        TraceSpan.CopilotChatResolveAgentContexts,
        {
          [TraceAttr.CopilotContextsCount]: normalizedContexts.length,
          [TraceAttr.CopilotResourceAttachmentsCount]: body.resourceAttachments?.length ?? 0,
        },
        () =>
          resolveAgentContexts({
            contexts: normalizedContexts,
            resourceAttachments: body.resourceAttachments,
            userId: authenticatedUserId,
            message: body.message,
            workspaceId,
            chatId: actualChatId,
            requestId,
          }),
        activeOtelRoot.context
      )
      const persistUserMessagePromise = persistUserMessage({
        chatId: actualChatId,
        userMessageId,
        message: body.message,
        fileAttachments: body.fileAttachments,
        contexts: normalizedContexts,
        workspaceId,
        notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
        parentOtelContext: activeOtelRoot.context,
      })
      const executionContextPromise = withCopilotSpan(
        TraceSpan.CopilotChatBuildExecutionContext,
        { [TraceAttr.CopilotBranchKind]: branch.kind },
        () =>
          branch.buildExecutionContext({
            userId: authenticatedUserId,
            chatId: actualChatId,
            userTimezone: body.userTimezone,
            messageId: userMessageId,
          }),
        activeOtelRoot.context
      )

      const [agentContexts, userPermission, entitlements, workspaceSnapshot, , executionContext] =
        await Promise.all([
          agentContextsPromise,
          userPermissionPromise,
          entitlementsPromise,
          workspaceContextPromise,
          persistUserMessagePromise,
          executionContextPromise,
        ])
      // Both halves come from one primary-db fetch (workspace-context.ts):
      // `workspaceContext` is the markdown transition fallback, `vfs` is the
      // typed snapshot Go diffs into baseline+delta messages.
      const workspaceContext = workspaceSnapshot?.markdown
      const vfs = workspaceSnapshot?.snapshot

      executionContext.userPermission = userPermission ?? undefined

      // buildPayload is the last synchronous step before the outbound
      // Sim → Go HTTP call. It runs per-tool schema generation (subscription
      // lookup + registry iteration, cached 30s) and file upload tracking
      // per attachment. Wrapping it so we can see how much of the
      // "before llm.stream" gap lives here vs elsewhere.
      const requestPayload = await withCopilotSpan(
        TraceSpan.CopilotChatBuildPayload,
        {
          [TraceAttr.CopilotBranchKind]: branch.kind,
          [TraceAttr.CopilotFileAttachmentsCount]: body.fileAttachments?.length ?? 0,
          [TraceAttr.CopilotContextsCount]: normalizedContexts.length,
        },
        () =>
          branch.kind === 'workflow'
            ? branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: agentContexts,
                fileAttachments: body.fileAttachments,
                userPermission: userPermission ?? undefined,
                entitlements,
                userTimezone: body.userTimezone,
                userMetadata,
                workflowId: branch.workflowId,
                workflowName: branch.workflowName,
                workspaceId: branch.workspaceId,
                mode: branch.mode,
                provider: branch.provider,
                commands: body.commands,
                prefetch: body.prefetch,
                implicitFeedback: body.implicitFeedback,
                workspaceContext,
                vfs,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                browserCapable: body.browserCapable === true,
              })
            : branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: agentContexts,
                fileAttachments: body.fileAttachments,
                userPermission: userPermission ?? undefined,
                entitlements,
                userTimezone: body.userTimezone,
                userMetadata,
                workspaceContext,
                vfs,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                browserCapable: body.browserCapable === true,
              }),
        activeOtelRoot.context
      )

      if (actualChatId) {
        activeOtelRoot.span.setAttribute(TraceAttr.ChatId, actualChatId)
      }
      if (workspaceId) {
        activeOtelRoot.span.setAttribute(TraceAttr.WorkspaceId, workspaceId)
      }

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
        requestId,
        workspaceId,
        otelRoot: activeOtelRoot,
        orchestrateOptions: {
          userId: authenticatedUserId,
          ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
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
            requestId,
            workspaceId,
            notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
            otelRoot,
          }),
          onError: buildOnError({
            chatId: actualChatId,
            userMessageId,
            requestId,
            workspaceId,
            notifyWorkspaceStatus: branch.notifyWorkspaceStatus,
          }),
        },
      })

      captureServerEvent(
        authenticatedUserId,
        'copilot_chat_sent',
        {
          ...(branch.kind === 'workflow' ? { workflow_id: branch.workflowId } : {}),
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
          has_file_attachments: (body.fileAttachments?.length ?? 0) > 0,
          has_contexts: normalizedContexts.length > 0,
          mode: branch.kind === 'workflow' ? branch.mode : 'agent',
        },
        workspaceId ? { groups: { workspace: workspaceId } } : undefined
      )

      // Expose the root gen_ai.agent.execute span's trace identity to
      // the browser so subsequent HTTP calls (stop, abort, confirm,
      // SSE reconnect) can echo it back as `traceparent` — making
      // all side-channel work on this request appear as child spans
      // of this same trace in Tempo instead of disconnected roots.
      // W3C traceparent format: `00-<trace-id>-<parent-id>-<flags>`.
      const rootCtx = activeOtelRoot.span.spanContext()
      const rootTraceparent = `00-${rootCtx.traceId}-${rootCtx.spanId}-${
        (rootCtx.traceFlags & 0x1) === 0x1 ? '01' : '00'
      }`
      return new Response(stream, {
        headers: {
          ...SSE_RESPONSE_HEADERS,
          traceparent: rootTraceparent,
        },
      })
    }) // end otelContextApi.with
  } catch (error) {
    if (chatStreamLockAcquired && actualChatId && userMessageId) {
      await releasePendingChatStream(actualChatId, userMessageId)
    }
    otelRoot?.finish('error', error)

    if (isZodError(error)) {
      return validationErrorResponse(error, 'Invalid request data')
    }

    if (isWorkspaceAccessDeniedError(error)) {
      return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
    }

    logger.error(`[${requestId}] Error handling unified chat request`, {
      error: getErrorMessage(error, 'Unknown error'),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
}
