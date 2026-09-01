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
import type { AtomicClaimResult } from '@/lib/core/idempotency'
import { chatSendIdempotency } from '@/lib/core/idempotency'
import {
  DESKTOP_TERMINAL_HINT_ID_MAX_LENGTH,
  DESKTOP_TERMINAL_HINT_TEXT_MAX_LENGTH,
} from '@/lib/mothership/chat/desktop-capabilities'
import { type ChatLoadResult, resolveOrCreateChat } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import { buildCopilotRequestPayload } from '@/lib/mothership/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  withStoppedContentBlock,
} from '@/lib/mothership/chat/persisted-message'
import {
  processContextsServer,
  resolveActiveResourceContext,
} from '@/lib/mothership/chat/process-contents'
import {
  MAX_FILE_SELECTION_TEXT_LENGTH,
  MAX_TABLE_SELECTION_COLUMNS,
  MAX_TABLE_SELECTION_ROWS,
  safeBrowserSelectionUrl,
} from '@/lib/mothership/chat/selection-context'
import { finalizeAssistantTurn } from '@/lib/mothership/chat/terminal-state'
import { chatPubSub } from '@/lib/mothership/chat-status'
import { COPILOT_REQUEST_MODES } from '@/lib/mothership/constants'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import { type ChatRequest, PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import {
  CopilotChatFinalizeOutcome,
  CopilotChatPersistOutcome,
  CopilotTransport,
} from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { createBadRequestResponse, createUnauthorizedResponse } from '@/lib/mothership/request/http'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/mothership/request/lifecycle/start'
import { startCopilotOtelRoot, withCopilotSpan } from '@/lib/mothership/request/otel'
import {
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/mothership/request/session'
import type { ExecutionContext, OrchestratorResult } from '@/lib/mothership/request/types'
import { persistChatResources } from '@/lib/mothership/resources/persistence'
import {
  hasAddressableId,
  isEphemeralResource,
  sanitizeChatResources,
} from '@/lib/mothership/resources/types'
import { prepareExecutionContext } from '@/lib/mothership/tools/handlers/context'
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
const CHAT_SELECTION_TEXT_MAX_LENGTH = 100_000
const CHAT_SELECTION_SOURCE_URL_MAX_LENGTH = 8_192
const CHAT_SELECTION_SOURCE_TITLE_MAX_LENGTH = 512
const TERMINAL_SELECTION_LINE_MAX = 10_000_000

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
    'generic',
    'browser',
    // Filtered out client-side rather than sent, but accepted here so a stray
    // terminal attachment degrades to a no-op instead of rejecting the whole
    // chat request.
    'terminal',
  ]),
  id: z.string().min(1),
  title: z.string().optional(),
  active: z.boolean().optional(),
  /**
   * Live page URL for `browser` attachments. The agent browser lives in the
   * desktop app, so the client supplies its state — the server has nothing
   * to resolve it from. Web-only: this string is interpolated into LLM
   * context, and rejecting other schemes (file://, chrome://…) keeps local
   * host paths from ever entering the copilot payload.
   */
  url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//, 'Must be an http(s) URL')
    .optional(),
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
  generic: 'Resource',
  browser: 'Browser',
  terminal: 'Terminal',
}

/**
 * Synthetic client-side panels are context-only: never persisted to the chat.
 * Browser tab attachments are normalized to the singleton Browser panel before
 * persistence; their page title and URL remain request context only.
 */
function isPersistableAttachment(resource: z.infer<typeof ResourceAttachmentSchema>): boolean {
  return !isEphemeralResource({
    type: resource.type,
    id: resource.id,
    title: resource.title ?? '',
  })
}

/**
 * Drops open tabs the client cannot address, so one unusable tab does not fail
 * the whole message — clients on a stale bundle still send them. A non-string
 * id is left in place for the schema to reject, since that is a malformed
 * request rather than a resource we merely cannot open.
 */
function dropUnaddressableAttachments(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((resource) => {
    const id = (resource as { id?: unknown } | null)?.id
    return typeof id !== 'string' || hasAddressableId(id)
  })
}

/** Non-strings pass through for the schema to reject; strings are sanitized. */
function sanitizeBrowserSelectionUrl(value: unknown): unknown {
  return typeof value === 'string' ? safeBrowserSelectionUrl(value) : value
}

const BrowserTextSelectionSchema = z
  .object({
    text: z.string().min(1).max(CHAT_SELECTION_TEXT_MAX_LENGTH),
    url: z.preprocess(
      sanitizeBrowserSelectionUrl,
      z.string().max(CHAT_SELECTION_SOURCE_URL_MAX_LENGTH).optional()
    ),
    title: z.string().max(CHAT_SELECTION_SOURCE_TITLE_MAX_LENGTH).optional(),
  })
  .strict()
  .transform(({ text, title, url }) => ({
    text,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  }))

const TerminalTextSelectionSchema = z
  .object({
    text: z.string().min(1).max(CHAT_SELECTION_TEXT_MAX_LENGTH),
    startLine: z.number().int().positive().max(TERMINAL_SELECTION_LINE_MAX),
    endLine: z.number().int().positive().max(TERMINAL_SELECTION_LINE_MAX),
  })
  .strict()
  .refine(({ startLine, endLine }) => endLine >= startLine, {
    message: 'endLine must be greater than or equal to startLine',
    path: ['endLine'],
  })

const ChatContextSchema = z
  .object({
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
      'table_selection',
      'file',
      'file_selection',
      'folder',
      'filefolder',
      'integration',
      'skill',
      'mcp',
      'browser_tab',
      'terminal_tab',
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
    serverId: z.string().optional(),
    scheduleId: z.string().optional(),
    tabId: z.string().optional(),
    terminalId: z.string().optional(),
    text: z.string().max(MAX_FILE_SELECTION_TEXT_LENGTH).optional(),
    fileName: z.string().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    tableName: z.string().optional(),
    rowIds: z.array(z.string()).max(MAX_TABLE_SELECTION_ROWS).optional(),
    columnIds: z.array(z.string()).max(MAX_TABLE_SELECTION_COLUMNS).optional(),
    selection: z.union([BrowserTextSelectionSchema, TerminalTextSelectionSchema]).optional(),
  })
  .superRefine(({ kind, selection }, refinementContext) => {
    if (!selection) return
    const isTerminalSelection = 'startLine' in selection
    const selectionMatchesKind =
      (kind === 'browser_tab' && !isTerminalSelection) ||
      (kind === 'terminal_tab' && isTerminalSelection)
    if (!selectionMatchesKind) {
      refinementContext.addIssue({
        code: 'custom',
        message: 'selection must match its browser_tab or terminal_tab context kind',
        path: ['selection'],
      })
    }
  })

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  /* Bounded because it becomes part of a Postgres key in `chatSendIdempotency`;
     a client-supplied id longer than the btree entry limit would throw there.
     A generated id is 36 chars. */
  userMessageId: z.string().max(128).optional(),
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
  resourceAttachments: z
    .preprocess(dropUnaddressableAttachments, z.array(ResourceAttachmentSchema))
    .optional(),
  provider: z.string().optional(),
  contexts: z.array(ChatContextSchema).optional(),
  commands: z.array(z.string()).optional(),
  userTimezone: z.string().optional(),
  /** Per-turn model effort dial; forwarded verbatim to the worker. */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /**
   * Contract ChatRequest.clientCapabilities: what this caller can execute client-side.
   * PRESENT = explicit declaration (empty array → no client pickup, dispatch runs
   * client-routed tools server-side immediately). ABSENT = legacy caller → dispatch
   * keeps its conservative pickup grace.
   */
  clientCapabilities: z.array(z.string()).optional(),
  desktopCapabilities: z
    .object({
      localFilesystem: z.boolean().optional(),
      browser: z.boolean().optional(),
      terminal: z.boolean().optional(),
      terminals: z
        .array(
          z.object({
            id: z.string().max(DESKTOP_TERMINAL_HINT_ID_MAX_LENGTH),
            cwd: z.string().max(DESKTOP_TERMINAL_HINT_TEXT_MAX_LENGTH).optional(),
            running: z.string().max(DESKTOP_TERMINAL_HINT_TEXT_MAX_LENGTH).optional(),
            interactive: z.boolean().optional(),
            active: z.boolean().optional(),
          })
        )
        .optional(),
      browserSessions: z
        .array(
          z.object({
            hostname: z
              .string()
              .max(253)
              .regex(/^[a-z0-9.-]+$/),
            evidence: z.enum(['sign-in-completed', 'cookies']),
            lastObservedAt: z.string().datetime(),
          })
        )
        .max(20)
        .optional(),
    })
    .optional(),
})

type UnifiedChatRequest = z.infer<typeof ChatMessageSchema>
type BrowserSessions = NonNullable<UnifiedChatRequest['desktopCapabilities']>['browserSessions']
type Terminals = NonNullable<UnifiedChatRequest['desktopCapabilities']>['terminals']
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
        mcpServerIds?: string[]
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        userTimezone?: string
        effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        workflowId: string
        workflowName?: string
        workspaceId?: string
        mode: UnifiedChatRequest['mode']
        provider?: string
        commands?: string[]
        prefetch?: boolean
        implicitFeedback?: string
        desktopLocalFilesystem?: boolean
        browser?: boolean
        terminalCapable?: boolean
        terminals?: Terminals
        browserSessions?: BrowserSessions
      }) => Promise<ChatRequest>
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
        mcpServerIds?: string[]
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        userPermission?: string
        userTimezone?: string
        effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        desktopLocalFilesystem?: boolean
        browser?: boolean
        terminalCapable?: boolean
        terminals?: Terminals
        browserSessions?: BrowserSessions
      }) => Promise<ChatRequest>
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

/**
 * An MCP server tagged with `/name` stays enabled for the rest of the chat, not
 * just the turn it was tagged on. Persisted user messages already carry their
 * `mcp` contexts, so the transcript is the source of truth — enablement survives
 * reloads and reopened chats with no extra state to keep in sync. There is
 * deliberately no off switch: history is append-only.
 *
 * Only the ids travel forward, not the contexts themselves. The tools ride the
 * tool array on every turn, so the model always sees their names and schemas;
 * re-expanding the prompt listing each turn would just duplicate that. Keeping
 * inherited servers out of the persisted contexts also keeps the `/name` chips
 * on a sent message showing only what the user actually typed that turn.
 */
function collectChatMcpServerIds(
  conversationHistory: unknown[],
  currentContexts: UnifiedChatRequest['contexts']
): string[] {
  const serverIds = new Set<string>()

  const collect = (contexts: unknown) => {
    if (!Array.isArray(contexts)) return
    for (const ctx of contexts) {
      if (!ctx || typeof ctx !== 'object') continue
      const { kind, serverId } = ctx as { kind?: unknown; serverId?: unknown }
      if (kind === 'mcp' && typeof serverId === 'string' && serverId) {
        serverIds.add(serverId)
      }
    }
  }

  for (const message of conversationHistory) {
    collect((message as { contexts?: unknown } | null)?.contexts)
  }
  collect(currentContexts)

  return Array.from(serverIds)
}

async function resolveAgentContexts(params: {
  contexts?: UnifiedChatRequest['contexts']
  resourceAttachments?: UnifiedChatRequest['resourceAttachments']
  userId: string
  message: string
  workspaceId?: string
  chatId?: string
  resolvedSecretTraceRegistry?: ExecutionContext['resolvedSecretTraceRegistry']
  requestId: string
}): Promise<Array<{ type: string; content: string; tag?: string; path?: string }>> {
  const {
    contexts,
    resourceAttachments,
    userId,
    message,
    workspaceId,
    chatId,
    resolvedSecretTraceRegistry,
    requestId,
  } = params

  let agentContexts: Array<{ type: string; content: string; tag?: string; path?: string }> = []

  if (Array.isArray(contexts) && contexts.length > 0) {
    try {
      agentContexts = await processContextsServer(
        contexts as ChatContext[],
        userId,
        message,
        workspaceId,
        chatId,
        resolvedSecretTraceRegistry
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
            content: `The user's ${
              resource.active ? 'currently visible browser tab' : 'other open browser tab'
            } (driven by the browser subagent) is open on: ${
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

  const [environmentContext, billingAttribution] = await Promise.all([
    prepareCopilotEnvironmentContext(userId, workspaceId),
    workspaceId
      ? resolveBillingAttribution({ actorUserId: userId, workspaceId })
      : Promise.resolve(undefined),
  ])
  return {
    userId,
    workflowId: workflowId ?? '',
    workspaceId,
    chatId,
    ...environmentContext,
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
            mcpServerIds: payloadParams.mcpServerIds,
            fileAttachments: payloadParams.fileAttachments,
            commands: payloadParams.commands,
            chatId: payloadParams.chatId,
            prefetch: payloadParams.prefetch,
            implicitFeedback: payloadParams.implicitFeedback,
            userPermission: payloadParams.userPermission,
            userTimezone: payloadParams.userTimezone,
            effort: payloadParams.effort,
            desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
            browser: payloadParams.browser,
            terminalCapable: payloadParams.terminalCapable,
            terminals: payloadParams.terminals,
            browserSessions: payloadParams.browserSessions,
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
          mcpServerIds: payloadParams.mcpServerIds,
          fileAttachments: payloadParams.fileAttachments,
          chatId: payloadParams.chatId,
          userPermission: payloadParams.userPermission,
          userTimezone: payloadParams.userTimezone,
          effort: payloadParams.effort,
          desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
          browser: payloadParams.browser,
          terminalCapable: payloadParams.terminalCapable,
          terminals: payloadParams.terminals,
          browserSessions: payloadParams.browserSessions,
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

/** Names what the key identifies: `chat-send:user-message:<id>:userId=<id>`. */
const CHAT_SEND_IDEMPOTENCY_PROVIDER = 'user-message'

/**
 * Claims this send so a retry of it can be recognised.
 *
 * Fails open: a missed deduplication costs a duplicate chat and turn, but
 * refusing the send loses the user's message. Returns `undefined` when the
 * store is unreachable, which sends normally with no claim to finalize.
 *
 * The key is scoped to the caller — `userMessageId` is client-supplied, so an
 * unscoped one would let a user probe another's sends for their chat id.
 */
async function claimChatSend(
  userMessageId: string,
  userId: string
): Promise<AtomicClaimResult | undefined> {
  try {
    return await chatSendIdempotency.atomicallyClaim(
      CHAT_SEND_IDEMPOTENCY_PROVIDER,
      userMessageId,
      { userId }
    )
  } catch (error) {
    logger.warn('Could not claim chat send; proceeding without deduplication', {
      userMessageId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return undefined
  }
}

/**
 * Answers a send whose `userMessageId` was already claimed.
 *
 * Deliberately the same 409 shape the pending-stream lock returns, because the
 * client's conflict handler already knows how to reattach to `activeStreamId`
 * instead of starting a turn — a duplicate send and a send that collided with
 * an in-flight one want exactly the same thing. `chatId` rides along when the
 * first attempt got far enough to resolve one, letting a chatless client adopt
 * it without a stream-to-chat lookup.
 */
function duplicateChatSendResponse(claim: AtomicClaimResult, userMessageId: string): NextResponse {
  const claimed = claim.existingResult?.result?.chatId
  const chatId = typeof claimed === 'string' && claimed ? claimed : undefined
  logger.info('Deduplicated a repeated chat send', { userMessageId, chatId })
  return NextResponse.json(
    {
      error: 'This message was already sent.',
      activeStreamId: userMessageId,
      ...(chatId ? { chatId } : {}),
    },
    { status: 409 }
  )
}

export async function handleUnifiedChatPost(req: NextRequest) {
  let actualChatId: string | undefined
  let userMessageId = ''
  let chatStreamLockAcquired = false
  /** Cleared once the chat is recorded against it, which makes it permanent. */
  let sendClaim: AtomicClaimResult | undefined
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

    const body = ChatMessageSchema.parse(await req.json())
    const normalizedContexts = normalizeContexts(body.contexts) ?? []
    userMessageId = body.userMessageId || generateId()

    sendClaim = await claimChatSend(userMessageId, authenticatedUserId)
    if (sendClaim?.claimed === false) {
      return duplicateChatSendResponse(sendClaim, userMessageId)
    }

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

      /* Record the chat as soon as it is known — the earliest a retry can be
         answered with somewhere to go. This does not make the claim permanent:
         several exits below still return without starting a turn, and a retry
         of those must be free to start one. Failing to record only costs a
         retry the chat-id shortcut, so it must not fail the send. */
      if (sendClaim?.claimToken && actualChatId) {
        await chatSendIdempotency
          .storeResult(
            sendClaim.normalizedKey,
            { success: true, status: 'completed', result: { chatId: actualChatId } },
            sendClaim.storageMethod,
            sendClaim.claimToken
          )
          .catch((error) => {
            logger.warn(`[${requestId}] Could not record the chat for this send`, {
              userMessageId,
              error: getErrorMessage(error, 'Unknown error'),
            })
          })
      }

      if (chatIsNew && actualChatId && body.resourceAttachments?.length) {
        // Canonicalizes here, not just inside `persistChatResources`: several
        // browser tabs collapse onto the one Browser panel before they are
        // stored, so the chat reopens with a single tab rather than one per page.
        const persistable = sanitizeChatResources(
          body.resourceAttachments.filter(isPersistableAttachment).map((resource) => ({
            type: resource.type,
            id: resource.id,
            title: resource.title ?? GENERIC_RESOURCE_TITLE[resource.type],
          }))
        )
        if (persistable.length > 0) {
          await persistChatResources(actualChatId, persistable)
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
      // Wrap the pre-LLM prep work in spans so the trace waterfall shows
      // where time is going between "request received" and "llm.stream
      // opens". Previously these ran bare under the root and inflated the
      // apparent "gap" before the model call. Each promise is its own
      // span; they run concurrently under Promise.all below.
      /**
       * Mothership revamp (worker backend): the VFS/workspace snapshot build is gone —
       * the worker discovers workspace state on demand through the CLI (was ~11 primary-db
       * queries and ~900ms p95 per message). Its prep slot now mints the run-scoped
       * delegation credential the worker presents on v2 calls (revamp D23).
       */
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
      const agentContextsPromise = executionContextPromise.then((executionContext) => {
        return withCopilotSpan(
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
              resolvedSecretTraceRegistry: executionContext.resolvedSecretTraceRegistry,
              requestId,
            }),
          activeOtelRoot.context
        )
      })
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
      const [agentContexts, userPermission, , executionContext] = await Promise.all([
        agentContextsPromise,
        userPermissionPromise,
        persistUserMessagePromise,
        executionContextPromise,
      ])

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
        () => {
          const mcpServerIds = collectChatMcpServerIds(conversationHistory, normalizedContexts)
          return branch.kind === 'workflow'
            ? branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: agentContexts,
                mcpServerIds,
                fileAttachments: body.fileAttachments,
                userPermission: userPermission ?? undefined,
                userTimezone: body.userTimezone,
                effort: body.effort,
                workflowId: branch.workflowId,
                workflowName: branch.workflowName,
                workspaceId: branch.workspaceId,
                mode: branch.mode,
                provider: branch.provider,
                commands: body.commands,
                prefetch: body.prefetch,
                implicitFeedback: body.implicitFeedback,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                browser: body.desktopCapabilities?.browser === true,
                terminalCapable: body.desktopCapabilities?.terminal === true,
                terminals: body.desktopCapabilities?.terminals,
                browserSessions: body.desktopCapabilities?.browserSessions,
              })
            : branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: agentContexts,
                mcpServerIds,
                fileAttachments: body.fileAttachments,
                userPermission: userPermission ?? undefined,
                userTimezone: body.userTimezone,
                effort: body.effort,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                browser: body.desktopCapabilities?.browser === true,
                terminalCapable: body.desktopCapabilities?.terminal === true,
                terminals: body.desktopCapabilities?.terminals,
                browserSessions: body.desktopCapabilities?.browserSessions,
              })
        },
        activeOtelRoot.context
      )

      if (actualChatId) {
        activeOtelRoot.span.setAttribute(TraceAttr.ChatId, actualChatId)
      }
      if (workspaceId) {
        activeOtelRoot.span.setAttribute(TraceAttr.WorkspaceId, workspaceId)
      }

      const stream = createSSEStream({
        requestPayload: {
          ...requestPayload,
          protocolVersion: PROTOCOL_VERSION,
        },
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
          // Executor routing is decided HERE, once per turn, from the caller's declared
          // capabilities — dispatch never discovers client absence by burning a grace timer.
          clientToolPickupExpected: body.clientCapabilities
            ? body.clientCapabilities.includes('workflow-tool-pickup')
            : true,
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
      /* A turn is running. Only now is the claim permanent, so the `finally`
         below leaves it in place and a retry of this send resolves to this
         chat instead of opening another. Every earlier exit returns without a
         turn, and releases. */
      sendClaim = undefined
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
      // A rejected body otherwise leaves no trace: the client sees a 400 and
      // its stream reconnect 404s, which reads as the stream dying for no reason.
      logger.warn(`[${requestId}] Rejected chat request as invalid`, {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
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
  } finally {
    /* A claim still held here never started a turn — the send threw, or
       returned early on a rejected branch, a missing chat, or a chat that
       already has a stream running. Release it so a retry may start one rather
       than deduplicating against a turn that never happened. Must be
       `finally`: those early returns skip `catch`. */
    if (sendClaim?.claimToken) {
      await chatSendIdempotency
        .release(sendClaim.normalizedKey, sendClaim.storageMethod, sendClaim.claimToken)
        .catch((releaseError) => {
          logger.warn('Could not release the claim for an unfinished send', {
            userMessageId,
            error: getErrorMessage(releaseError, 'Unknown error'),
          })
        })
    }
  }
}
