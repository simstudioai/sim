import { context as otelContextApi } from '@opentelemetry/api'
import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { chatContextSchema } from '@/lib/api/contracts/mothership-chat-context'
import { mothershipResourceAttachmentSchema as ResourceAttachmentSchema } from '@/lib/api/contracts/mothership-resources'
import { isZodError, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/attribution'
import { type AtomicClaimResult, chatSendIdempotency } from '@/lib/core/idempotency'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { listPersonalCredentials } from '@/lib/credentials/application/personal-credentials'
import {
  isKnowledgeMemberAccessAvailable,
  requireOrganizationSearchAvailable,
} from '@/lib/knowledge/access/availability'
import { loadCopilotSearchIntegrations } from '@/lib/mothership/application/load-search-integrations'
import { chatOperations } from '@/lib/mothership/application/operations'
import {
  authoringInvocation,
  createCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { admitChatTurn } from '@/lib/mothership/chat/application/admit-turn'
import { ChatSendSupersededError } from '@/lib/mothership/chat/application/send-superseded'
import {
  type AssistantImageContent,
  prepareOrganizationChatAttachments,
} from '@/lib/mothership/chat/assistant-images'
import { buildOnComplete, buildOnError } from '@/lib/mothership/chat/completion'
import { MAX_CHAT_CONTEXTS, MAX_CHAT_MESSAGE_LENGTH } from '@/lib/mothership/chat/context-limits'
import {
  DESKTOP_TERMINAL_HINT_ID_MAX_LENGTH,
  DESKTOP_TERMINAL_HINT_TEXT_MAX_LENGTH,
} from '@/lib/mothership/chat/desktop-capabilities'
import {
  type ChatLoadResult,
  loadChatMcpServerIds,
  resolveOrCreateChat,
} from '@/lib/mothership/chat/lifecycle'
import { authorizeOrganizationChat } from '@/lib/mothership/chat/organization-chats'
import { buildCopilotRequestPayload } from '@/lib/mothership/chat/payload'
import { processContextsServer } from '@/lib/mothership/chat/process-contents'
import { resolveResourceAttachmentContexts } from '@/lib/mothership/chat/resource-attachments'
import {
  COPILOT_REQUEST_MODES,
  MOTHERSHIP_CHAT_ID_HEADER,
  MOTHERSHIP_DESKTOP_EXECUTOR_HEADER,
} from '@/lib/mothership/constants'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import {
  type ChatContextItem,
  type ChatRequest,
  type ModelSelection,
  ModelSelectionSchema,
  PROTOCOL_VERSION,
} from '@/lib/mothership/generated/protocol'
import { CopilotTransport } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { resolveMothershipModelSettings } from '@/lib/mothership/model-options'
import { createBadRequestResponse, createUnauthorizedResponse } from '@/lib/mothership/request/http'
import { durableResourceAuthoringVersion } from '@/lib/mothership/request/lifecycle/recovery-config'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/mothership/request/lifecycle/start'
import { startCopilotOtelRoot, withCopilotSpan } from '@/lib/mothership/request/otel'
import {
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
} from '@/lib/mothership/request/session'
import { getLocalChatStreamLease } from '@/lib/mothership/request/session/abort'
import type { ExecutionContext } from '@/lib/mothership/request/types'
import { hasAddressableId } from '@/lib/mothership/resources/types'
import { prepareExecutionContext } from '@/lib/mothership/tools/handlers/context'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { captureServerEvent } from '@/lib/posthog/server'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import {
  getUserEntityPermissions,
  isWorkspaceAccessDeniedError,
  type PermissionType,
} from '@/lib/workspaces/permissions/utils'
import type { ChatContext } from '@/stores/panel'

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

const ChatMessageSchema = z
  .object({
    message: z.string().max(MAX_CHAT_MESSAGE_LENGTH),
    /* Bounded because it becomes part of a Postgres key in `chatSendIdempotency`;
     a client-supplied id longer than the btree entry limit would throw there.
     A generated id is 36 chars. */
    userMessageId: z.string().max(128).optional(),
    chatId: z.string().optional(),
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    organizationId: z.string().min(1).max(200).optional(),
    workflowName: z.string().optional(),
    model: z.string().optional().default(DEFAULT_MODEL),
    mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
    assistantSearch: workspaceSearchFiltersSchema.optional(),
    assistantFast: z.boolean().optional(),
    assistantSearchLevel: AssistantSearchLevel.optional(),
    prefetch: z.boolean().optional(),
    createNewChat: z.boolean().optional().default(false),
    implicitFeedback: z.string().optional(),
    fileAttachments: z.array(FileAttachmentSchema).optional(),
    resourceAttachments: z
      .preprocess(dropUnaddressableAttachments, z.array(ResourceAttachmentSchema))
      .optional(),
    provider: z.string().optional(),
    contexts: z.array(chatContextSchema).max(MAX_CHAT_CONTEXTS).optional(),
    commands: z.array(z.string()).optional(),
    userTimezone: z.string().optional(),
    effort: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    modelSelection: ModelSelectionSchema.optional(),
    clientCapabilities: z.array(z.string()).optional(),
    desktopCapabilities: z
      .object({
        localFilesystem: z.boolean().optional(),
        localFiles: z.boolean().optional(),
        localReadClaims: z.boolean().optional(),
        /** The composer's desktop install, offered for its background executor. */
        deviceId: z.string().uuid().optional(),
        /** The background executor protocol version the desktop speaks. */
        executor: z.number().int().min(1).max(1000).optional(),
        browser: z.boolean().optional(),
        terminal: z.boolean().optional(),
        computerUse: z.boolean().optional(),
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
  .superRefine((body, ctx) => {
    if (body.assistantSearchLevel !== undefined && body.mode !== 'assistant')
      ctx.addIssue({
        code: 'custom',
        message: 'Search levels require Assistant mode',
        path: ['assistantSearchLevel'],
      })
    if (body.assistantSearchLevel && (body.modelSelection || body.assistantFast !== undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'Search level cannot include another model selection or Fast flag',
        path: ['assistantSearchLevel'],
      })
    if (body.assistantFast !== undefined && body.mode !== 'assistant')
      ctx.addIssue({
        code: 'custom',
        message: 'Fast Search requires Assistant mode',
        path: ['assistantFast'],
      })
    if (body.assistantFast && body.modelSelection)
      ctx.addIssue({
        code: 'custom',
        message: 'Fast Search cannot include another model selection',
        path: ['assistantFast'],
      })
  })
  .refine(
    (body) => body.message.length > 0 || (!!body.organizationId && !!body.fileAttachments?.length),
    { message: 'Message is required', path: ['message'] }
  )

type UnifiedChatRequest = z.infer<typeof ChatMessageSchema>

/**
 * The desktop a turn asks its background executor to run on. Only a desktop composer that speaks
 * the executor protocol and switched on at least one desktop surface asks; Assistant turns have
 * no desktop tools.
 */
function backgroundExecutorDeviceId(body: UnifiedChatRequest): string | undefined {
  const desktop = body.desktopCapabilities
  if (body.mode === 'assistant' || !desktop?.deviceId || !desktop.executor) return undefined
  return desktop.browser ||
    desktop.terminal ||
    desktop.localFiles ||
    desktop.localFilesystem ||
    desktop.computerUse
    ? desktop.deviceId
    : undefined
}

type BrowserSessions = NonNullable<UnifiedChatRequest['desktopCapabilities']>['browserSessions']
type Terminals = NonNullable<UnifiedChatRequest['desktopCapabilities']>['terminals']
type UnifiedChatBranch =
  | {
      kind: 'workflow'
      workflowId: string
      workflowName?: string
      /** Always present: the resolver's 'resolved' variant guarantees it (the workflow's
       * own workspace) — the wire contract requires it. */
      workspaceId: string
      effectiveModel: string
      selectedModel: string
      mode: UnifiedChatRequest['mode']
      provider?: string
      goRoute: '/api/copilot'
      titleModel: string
      titleProvider?: string
      notifyChatStatus: false
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
        effort?: ChatRequest['effort']
        modelSelection?: ModelSelection
        workflowId: string
        workflowName?: string
        workspaceId: string
        mode: UnifiedChatRequest['mode']
        provider?: string
        commands?: string[]
        prefetch?: boolean
        implicitFeedback?: string
        assistantSearchLevel?: AssistantSearchLevel
        assistantFast?: boolean
        assistantSearch?: WorkspaceSearchFilters
        workspaceContext?: string
        desktopLocalFiles?: boolean
        desktopLocalFilesystem?: boolean
        browser?: boolean
        terminalCapable?: boolean
        computerUse?: boolean
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
  | ((
      | { kind: 'workspace'; workspaceId: string; organizationId?: never }
      | { kind: 'organization'; organizationId: string; workspaceId?: never }
    ) & {
      workspacePermission: PermissionType | null
      effectiveModel: string
      goRoute: '/api/mothership'
      titleModel: string
      titleProvider?: undefined
      notifyChatStatus: boolean
      buildPayload: (params: {
        message: string
        userId: string
        userMessageId: string
        chatId?: string
        contexts: Array<{ type: string; content: string; tag?: string; path?: string }>
        mcpServerIds?: string[]
        fileAttachments?: UnifiedChatRequest['fileAttachments']
        assistantImages?: AssistantImageContent[]
        userPermission?: string
        userTimezone?: string
        assistantSearchLevel?: AssistantSearchLevel
        assistantFast?: boolean
        assistantSearch?: WorkspaceSearchFilters
        workspaceContext?: string
        effort?: ChatRequest['effort']
        modelSelection?: ModelSelection
        desktopLocalFiles?: boolean
        desktopLocalFilesystem?: boolean
        browser?: boolean
        terminalCapable?: boolean
        computerUse?: boolean
        terminals?: Terminals
        browserSessions?: BrowserSessions
      }) => Promise<ChatRequest>
      buildExecutionContext: (params: {
        userId: string
        chatId?: string
        userTimezone?: string
        messageId: string
      }) => Promise<ExecutionContext>
    })

function normalizeContexts(contexts: UnifiedChatRequest['contexts']) {
  if (!Array.isArray(contexts)) {
    return contexts
  }

  return contexts.map((ctx) => {
    if (ctx.kind === 'table' && ctx.currentView)
      return { ...ctx, viewId: ctx.currentView.viewId ?? undefined }
    if (ctx.kind !== 'blocks') return ctx
    if (Array.isArray(ctx.blockIds) && ctx.blockIds.length > 0) return ctx
    if (ctx.blockId) return { ...ctx, blockIds: [ctx.blockId] }
    return ctx
  })
}

/**
 * An MCP server tagged with `/name` stays tagged for the rest of the chat, not
 * just the turn it was tagged on. Every usable workspace server is discoverable
 * without a tag; a tag marks the servers the user means, whose operations the
 * integration catalog ranks first and lists completely. Persisted user messages
 * already carry their `mcp` contexts, so the transcript is the source of truth —
 * tags survive reloads and reopened chats with no extra state to keep in sync.
 * There is deliberately no off switch: history is append-only.
 *
 * Only the ids travel forward, not the contexts themselves. The agent discovers
 * operations on demand, so re-expanding the prompt listing each turn adds
 * nothing. Keeping inherited servers out of the persisted contexts also keeps
 * the `/name` chips on a sent message showing only what the user actually typed
 * that turn.
 */
function collectChatMcpServerIds(
  chatMcpServerIds: string[],
  currentContexts: UnifiedChatRequest['contexts']
): string[] {
  const serverIds = new Set(chatMcpServerIds)
  for (const ctx of currentContexts ?? []) {
    if (ctx.kind === 'mcp' && ctx.serverId) serverIds.add(ctx.serverId)
  }
  return Array.from(serverIds)
}

async function resolveAgentContexts(params: {
  requestMode: UnifiedChatRequest['mode']
  contexts?: UnifiedChatRequest['contexts']
  resourceAttachments?: UnifiedChatRequest['resourceAttachments']
  organizationId?: string
  persistResources?: boolean
  browserAvailable?: boolean
  userId: string
  message: string
  workspaceId?: string
  chatId?: string
  resolvedSecretTraceRegistry?: ExecutionContext['resolvedSecretTraceRegistry']
  requestId: string
}): Promise<ChatContextItem[]> {
  const {
    requestMode,
    contexts,
    resourceAttachments,
    organizationId,
    persistResources,
    browserAvailable,
    userId,
    message,
    workspaceId,
    chatId,
    resolvedSecretTraceRegistry,
    requestId,
  } = params

  let agentContexts: ChatContextItem[] = []

  if (Array.isArray(contexts) && contexts.length > 0) {
    try {
      agentContexts = await processContextsServer(
        contexts as ChatContext[],
        userId,
        message,
        workspaceId,
        chatId,
        resolvedSecretTraceRegistry,
        organizationId,
        requestMode
      )
    } catch (error) {
      logger.error(`[${requestId}] Failed to process contexts`, error)
    }
  }

  agentContexts.push(
    ...(await resolveResourceAttachmentContexts({
      resourceAttachments,
      userId,
      workspaceId,
      organizationId,
      chatId,
      requestMode,
      persistResources,
      browserAvailable,
      requestId,
    }))
  )
  return agentContexts
}

async function buildInitialExecutionContext(params: {
  userId: string
  workflowId?: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  messageId: string
  userTimezone?: string
  requestMode: string
}): Promise<ExecutionContext> {
  const {
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    messageId,
    userTimezone,
    requestMode,
  } = params

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
    prepareCopilotEnvironmentContext(userId, workspaceId, {
      includeSecrets: requestMode !== 'assistant' && !organizationId,
    }),
    organizationId
      ? resolveOrganizationBillingAttribution({ actorUserId: userId, organizationId })
      : workspaceId
        ? resolveBillingAttribution({ actorUserId: userId, workspaceId })
        : Promise.resolve(undefined),
  ])
  return {
    userId,
    workflowId: workflowId ?? '',
    workspaceId,
    organizationId,
    chatId,
    ...environmentContext,
    billingAttribution,
    messageId,
    userTimezone,
    requestMode,
    copilotToolExecution: true,
  }
}

async function resolveBranch(params: {
  authenticatedUserId: string
  /** The caller's session principal, for reads the request packs on the caller's behalf. */
  principal: SessionPrincipal
  workflowId?: string
  workflowName?: string
  workspaceId?: string
  organizationId?: string
  model?: string
  mode?: UnifiedChatRequest['mode']
  provider?: string
}): Promise<UnifiedChatBranch | NextResponse> {
  const {
    authenticatedUserId,
    principal,
    workflowId: providedWorkflowId,
    workflowName,
    workspaceId: requestedWorkspaceId,
    organizationId,
    model,
    mode,
    provider,
  } = params

  if (organizationId) {
    if (!principal) return createUnauthorizedResponse()
    if (
      requestedWorkspaceId ||
      providedWorkflowId ||
      workflowName ||
      (mode !== 'assistant' && mode !== 'agent' && mode !== 'plan')
    ) {
      return createBadRequestResponse(
        'Organization conversations require agent or Assistant mode without a workspace or workflow'
      )
    }
    await authorizeOrganizationChat.execute({ principal, input: { organizationId, mode } })
    if (mode === 'assistant') await requireOrganizationSearchAvailable(organizationId)
    return {
      kind: 'organization',
      organizationId,
      workspacePermission: null,
      effectiveModel: DEFAULT_MODEL,
      goRoute: '/api/mothership',
      titleModel: DEFAULT_MODEL,
      notifyChatStatus: true,
      buildPayload: async (payloadParams) =>
        buildCopilotRequestPayload({
          ...payloadParams,
          principal,
          organizationId,
          mode,
          model: '',
        }),
      buildExecutionContext: async ({ userId, chatId, userTimezone, messageId }) =>
        buildInitialExecutionContext({
          userId,
          organizationId,
          chatId,
          messageId,
          userTimezone,
          requestMode: mode,
        }),
    }
  }

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
      notifyChatStatus: false,
      buildPayload: async (payloadParams) =>
        buildCopilotRequestPayload({
          message: payloadParams.message,
          workflowId: payloadParams.workflowId,
          workflowName: payloadParams.workflowName,
          workspaceId: payloadParams.workspaceId,
          userId: payloadParams.userId,
          principal,
          userMessageId: payloadParams.userMessageId,
          mode: payloadParams.mode ?? 'agent',
          model: selectedModel,
          provider: payloadParams.provider,
          contexts: payloadParams.contexts,
          assistantSearch: payloadParams.assistantSearch,
          assistantFast: payloadParams.assistantFast,
          assistantSearchLevel: payloadParams.assistantSearchLevel,
          mcpServerIds: payloadParams.mcpServerIds,
          fileAttachments: payloadParams.fileAttachments,
          commands: payloadParams.commands,
          chatId: payloadParams.chatId,
          prefetch: payloadParams.prefetch,
          implicitFeedback: payloadParams.implicitFeedback,
          userPermission: payloadParams.userPermission,
          userTimezone: payloadParams.userTimezone,
          effort: payloadParams.effort,
          modelSelection: payloadParams.modelSelection,
          desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
          desktopLocalFiles: payloadParams.desktopLocalFiles,
          browser: payloadParams.browser,
          terminalCapable: payloadParams.terminalCapable,
          computerUse: payloadParams.computerUse,
          terminals: payloadParams.terminals,
          browserSessions: payloadParams.browserSessions,
        }),
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
    notifyChatStatus: true,
    buildPayload: async (payloadParams) =>
      buildCopilotRequestPayload({
        message: payloadParams.message,
        workspaceId: requestedWorkspaceId,
        userId: payloadParams.userId,
        principal,
        userMessageId: payloadParams.userMessageId,
        mode: mode ?? 'agent',
        model: '',
        contexts: payloadParams.contexts,
        workspaceContext: payloadParams.workspaceContext,
        assistantSearch: payloadParams.assistantSearch,
        assistantFast: payloadParams.assistantFast,
        assistantSearchLevel: payloadParams.assistantSearchLevel,
        mcpServerIds: payloadParams.mcpServerIds,
        fileAttachments: payloadParams.fileAttachments,
        chatId: payloadParams.chatId,
        userPermission: payloadParams.userPermission,
        userTimezone: payloadParams.userTimezone,
        effort: payloadParams.effort,
        modelSelection: payloadParams.modelSelection,
        desktopLocalFilesystem: payloadParams.desktopLocalFilesystem,
        desktopLocalFiles: payloadParams.desktopLocalFiles,
        browser: payloadParams.browser,
        terminalCapable: payloadParams.terminalCapable,
        computerUse: payloadParams.computerUse,
        terminals: payloadParams.terminals,
        browserSessions: payloadParams.browserSessions,
      }),
    buildExecutionContext: async ({ userId, chatId, userTimezone, messageId }) =>
      buildInitialExecutionContext({
        userId,
        workspaceId: requestedWorkspaceId,
        chatId,
        messageId,
        userTimezone,
        requestMode: mode ?? 'agent',
      }),
  }
}

/** Names what the key identifies: `chat-send:user-message:<id>:userId=<id>`. */
const CHAT_SEND_IDEMPOTENCY_PROVIDER = 'user-message'

/**
 * Claims this send so a retry of it can be recognised.
 *
 * Fails closed: the claim is stored in Postgres (`chatSendIdempotency` forces
 * database storage), so a store failure throws and the send is answered with a
 * 500 rather than run without deduplication.
 *
 * The key is scoped to the caller — `userMessageId` is client-supplied, so an
 * unscoped one would let a user probe another's sends for their chat id.
 */
async function claimChatSend(userMessageId: string, userId: string): Promise<AtomicClaimResult> {
  return chatSendIdempotency.atomicallyClaim(CHAT_SEND_IDEMPOTENCY_PROVIDER, userMessageId, {
    userId,
  })
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
    // Admission records a send's own effort as the chat's explicit choice.
    const effortChoice = body.mode === 'assistant' ? undefined : body.effort
    let modelSelectorEnabled = false
    if (body.mode !== 'assistant') {
      const [selectorEnabled, planEnabled] = await Promise.all([
        isMothershipModelSelectorEnabled(),
        body.mode === 'plan' ? isPlanModeEnabled(authenticatedUserId) : false,
      ])
      modelSelectorEnabled = selectorEnabled
      if (body.mode === 'plan' && !planEnabled)
        return createBadRequestResponse('Plan mode is disabled')
    }
    if (
      body.mode === 'assistant' &&
      (body.workflowId ||
        body.workflowName ||
        (body.fileAttachments?.length && !body.organizationId) ||
        body.contexts?.length)
    ) {
      return createBadRequestResponse(
        'Assistant uses the Enterprise Search index. Switch to Build to use workspace resources or workflows.'
      )
    }

    const normalizedContexts =
      body.mode === 'assistant' ? [] : (normalizeContexts(body.contexts) ?? [])
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
            principal: {
              kind: 'session',
              userId: authenticatedUserId,
              sessionId: session.session.id,
            },
            workflowId: body.workflowId,
            workflowName: body.workflowName,
            workspaceId: body.workspaceId,
            organizationId: body.organizationId,
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

      /**
       * permission-group-enforced: copilot.use — Chat is a raw handler rather
       * than a workspace operation, so the authorization funnel never sees it.
       * The capability is read off `chatOperations.send` rather than restated,
       * so the assertion and the refusal cannot drift from the declaration a
       * declarative surface would enforce — including the `'none'` case, where
       * a declarative surface asserts nothing and so does this.
       *
       * Gated on the workspace the turn actually lands in, which is the one
       * `resolveBranch` just resolved rather than the one the request asked
       * for. A send naming `workflowId` resolves the workflow's own workspace
       * and ignores any `workspaceId` beside it, so reading the request's copy
       * would aim the check at a workspace the chat never touches — or, with
       * no `workspaceId` sent at all, skip it entirely. A branch that resolves
       * no workspace is governed by no group.
       *
       * Still ahead of everything durable: no chat is resolved, no pending
       * stream lock is taken and no run is created, which also settles the
       * resume stream — with no run there is nothing to replay. The send claim
       * taken above is released by the `finally`, so a refused send leaves a
       * later retry free to start a turn.
       */
      const chatCapability = chatOperations.send.capability
      if (
        branch.workspaceId &&
        chatCapability !== 'none' &&
        (await isWorkspaceCapabilityWithheld(
          authenticatedUserId,
          branch.workspaceId,
          chatCapability
        ))
      ) {
        activeOtelRoot.span.setAttribute(TraceAttr.HttpStatusCode, 403)
        activeOtelRoot.finish('error')
        return capabilityRefusalResponse(chatCapability)
      }

      const assistantImages =
        branch.kind === 'organization' && body.fileAttachments?.length
          ? await prepareOrganizationChatAttachments({
              principal: {
                kind: 'session',
                userId: authenticatedUserId,
                sessionId: session.session.id,
              },
              organizationId: branch.organizationId,
              mode:
                body.mode === 'plan' ? 'plan' : body.mode === 'assistant' ? 'assistant' : 'agent',
              attachments: body.fileAttachments,
              signal: req.signal,
            })
          : undefined
      const fileAttachments = assistantImages?.attachments ?? body.fileAttachments

      /* Prompt content is captured only once the turn is going to run. Both
         calls are internally gated on
         OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, but the gate is on
         whether capture is enabled at all, not on whether this caller may send
         — so stamping them at span start exported the message of every turn the
         capability check above then refused. Every refusal ahead of this point
         (a rejected branch, a withheld `copilot.use`) now records the shape of
         the request and none of its content. */
      activeOtelRoot.setUserMessagePreview(body.message)
      activeOtelRoot.setInputMessages({ userMessage: body.message })

      let currentChat: ChatLoadResult['chat'] = null
      let chatIsNew = false
      actualChatId = body.chatId

      if (body.chatId || body.createNewChat || branch.kind === 'organization') {
        const chatResult = await withCopilotSpan(
          TraceSpan.CopilotChatResolveOrCreateChat,
          {
            [TraceAttr.ChatPreexisting]: !!body.chatId,
            [TraceAttr.CopilotChatIsNew]: !!body.createNewChat,
          },
          () =>
            resolveOrCreateChat({
              chatId: body.chatId,
              mode:
                body.mode === 'plan' ? 'plan' : body.mode === 'assistant' ? 'assistant' : 'agent',
              userId: authenticatedUserId,
              ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
              workspaceId: branch.workspaceId,
              ...(branch.kind === 'organization'
                ? {
                    organizationId: branch.organizationId,
                    principal: {
                      kind: 'session' as const,
                      userId: authenticatedUserId,
                      sessionId: session.session.id,
                    },
                  }
                : {}),
              model: branch.titleModel,
              type: branch.kind === 'workflow' ? 'copilot' : 'mothership',
            }),
          activeOtelRoot.context
        )
        currentChat = chatResult.chat
        actualChatId = chatResult.chatId || body.chatId
        chatIsNew = chatResult.isNew

        if (body.chatId && !currentChat) {
          activeOtelRoot.span.setAttribute(TraceAttr.HttpStatusCode, 404)
          activeOtelRoot.finish('error')
          return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
        }
      }
      if (body.mode !== 'assistant')
        Object.assign(
          body,
          resolveMothershipModelSettings(
            {
              effort: effortChoice ?? currentChat?.effort ?? undefined,
              modelSelection: body.modelSelection,
            },
            modelSelectorEnabled,
            body.mode === 'plan'
          )
        )

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
        /** Only the explicit selection is known here; the worker resolves the default and provider. */
        model: body.modelSelection?.model,
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
      const personalCredentialsPromise =
        workspaceId && body.mode === 'assistant'
          ? listPersonalCredentials.execute({
              principal: {
                kind: 'session',
                userId: authenticatedUserId,
                sessionId: session.session.id,
              },
              input: { workspaceId },
            })
          : Promise.resolve(undefined)
      // Wrap the pre-LLM prep work in spans so the trace waterfall shows
      // where time is going between "request received" and "llm.stream
      // opens". Previously these ran bare under the root and inflated the
      // apparent "gap" before the model call. Each promise is its own
      // span; they run concurrently under Promise.all below.
      // Resolve environment and billing context before preparing the durable start intent.
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
        if (body.mode === 'assistant') return []
        return withCopilotSpan(
          TraceSpan.CopilotChatResolveAgentContexts,
          {
            [TraceAttr.CopilotContextsCount]: normalizedContexts.length,
            [TraceAttr.CopilotResourceAttachmentsCount]: body.resourceAttachments?.length ?? 0,
          },
          () =>
            resolveAgentContexts({
              requestMode: body.mode,
              contexts: normalizedContexts,
              resourceAttachments: body.resourceAttachments,
              organizationId: branch.kind === 'organization' ? branch.organizationId : undefined,
              persistResources: chatIsNew && body.mode !== 'assistant',
              browserAvailable:
                body.mode !== 'assistant' && body.desktopCapabilities?.browser === true,
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
      const chatMcpServerIdsPromise =
        currentChat && !chatIsNew ? loadChatMcpServerIds(currentChat.id) : Promise.resolve([])
      const [
        agentContexts,
        userPermission,
        executionContext,
        personalCredentials,
        chatMcpServerIds,
      ] = await Promise.all([
        agentContextsPromise,
        userPermissionPromise,
        executionContextPromise,
        personalCredentialsPromise,
        chatMcpServerIdsPromise,
      ])
      let workspaceContext: string | undefined
      if (personalCredentials) {
        workspaceContext = JSON.stringify({
          credentials: personalCredentials.credentials.map((credential) => ({
            id: credential.id,
            providerId: credential.providerId,
            displayName: credential.displayName,
            ...(credential.type === 'personal_token'
              ? { instanceUrl: credential.instanceUrl }
              : {}),
          })),
        })
      }
      if (
        branch.kind === 'organization' &&
        actualChatId &&
        (body.mode === 'assistant' ||
          (await isKnowledgeMemberAccessAvailable({ organizationId: branch.organizationId })))
      ) {
        workspaceContext = await loadCopilotSearchIntegrations({
          userId: authenticatedUserId,
          organizationId: branch.organizationId,
          chatId: actualChatId,
          messageId: userMessageId,
          signal: req.signal,
        })
      }
      const turnContexts = agentContexts
      if (body.mode === 'assistant' || branch.kind === 'organization')
        executionContext.assistantSearch = body.assistantSearch

      executionContext.userPermission = userPermission ?? undefined
      const invocation = authoringInvocation({ chatId: actualChatId, workspaceId })
      if (invocation)
        executionContext.copilotResourceAdmission = createCopilotResourceAdmission({
          userId: authenticatedUserId,
          invocation,
        })

      /** Trace catalog preparation and attachment tracking before durable admission. */
      const preparedPayload = await withCopilotSpan(
        TraceSpan.CopilotChatBuildPayload,
        {
          [TraceAttr.CopilotBranchKind]: branch.kind,
          [TraceAttr.CopilotFileAttachmentsCount]: body.fileAttachments?.length ?? 0,
          [TraceAttr.CopilotContextsCount]: normalizedContexts.length,
        },
        () => {
          const mcpServerIds = collectChatMcpServerIds(chatMcpServerIds, normalizedContexts)
          return branch.kind === 'workflow'
            ? branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: turnContexts,
                assistantSearch: body.mode === 'assistant' ? body.assistantSearch : undefined,
                assistantFast: body.assistantFast,
                assistantSearchLevel: body.assistantSearchLevel,
                mcpServerIds,
                fileAttachments,
                userPermission: userPermission ?? undefined,
                userTimezone: body.userTimezone,
                effort: body.effort,
                modelSelection: body.modelSelection,
                workflowId: branch.workflowId,
                workflowName: branch.workflowName,
                workspaceId: branch.workspaceId,
                mode: branch.mode,
                provider: branch.provider,
                commands: body.commands,
                prefetch: body.prefetch,
                implicitFeedback: body.implicitFeedback,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                desktopLocalFiles: body.desktopCapabilities?.localFiles === true,
                browser: body.desktopCapabilities?.browser === true,
                terminalCapable: body.desktopCapabilities?.terminal === true,
                computerUse: body.desktopCapabilities?.computerUse === true,
                terminals: body.desktopCapabilities?.terminals,
                browserSessions: body.desktopCapabilities?.browserSessions,
              })
            : branch.buildPayload({
                message: body.message,
                userId: authenticatedUserId,
                userMessageId,
                chatId: actualChatId,
                contexts: turnContexts,
                assistantSearch:
                  body.mode === 'assistant' || branch.kind === 'organization'
                    ? body.assistantSearch
                    : undefined,
                mcpServerIds,
                fileAttachments,
                assistantImages: assistantImages?.content,
                assistantFast: body.assistantFast,
                assistantSearchLevel: body.assistantSearchLevel,
                workspaceContext,
                userPermission: userPermission ?? undefined,
                userTimezone: body.userTimezone,
                effort: body.effort,
                modelSelection: body.modelSelection,
                desktopLocalFilesystem: body.desktopCapabilities?.localFilesystem === true,
                desktopLocalFiles: body.desktopCapabilities?.localFiles === true,
                browser: body.desktopCapabilities?.browser === true,
                terminalCapable: body.desktopCapabilities?.terminal === true,
                computerUse: body.desktopCapabilities?.computerUse === true,
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

      const clientToolPickupExpected =
        body.mode === 'assistant'
          ? false
          : body.clientCapabilities
            ? body.clientCapabilities.includes('workflow-tool-pickup')
            : true
      const requestPayload = { ...preparedPayload, protocolVersion: PROTOCOL_VERSION }
      const lease = actualChatId ? getLocalChatStreamLease(actualChatId, userMessageId) : undefined
      const runController = lease ? { id: runId, token: lease.value } : undefined
      let admittedRun: Awaited<ReturnType<typeof admitChatTurn.execute>> | undefined
      if (actualChatId) {
        if (!lease || !sendClaim?.claimToken || sendClaim.storageMethod !== 'database') {
          throw new Error('Chat admission requires its controller and durable send claim')
        }
        const resourceAuthoringVersion = durableResourceAuthoringVersion(
          executionContext.copilotResourceAdmission !== undefined
        )
        admittedRun = await admitChatTurn.execute({
          principal: {
            kind: 'session',
            userId: authenticatedUserId,
            sessionId: session.session.id,
          },
          input: {
            chatId: actualChatId,
            runId,
            executionId,
            requestId,
            lease,
            sendClaim: { normalizedKey: sendClaim.normalizedKey, claimToken: sendClaim.claimToken },
            message: {
              id: userMessageId,
              content: body.message,
              fileAttachments,
              contexts: normalizedContexts,
              requestMode:
                body.mode === 'plan' ? 'plan' : body.mode === 'assistant' ? 'assistant' : 'agent',
            },
            recovery: {
              kind: 'interactive_stream',
              resourceAuthoringVersion,
              request: { ...requestPayload, messageId: userMessageId, chatId: actualChatId },
              goRoute: branch.goRoute,
              clientToolPickupExpected,
              userTimezone: executionContext.userTimezone,
              requestMode: body.mode,
            },
            notifyWorkspaceStatus: branch.notifyChatStatus,
            // The effort this turn actually runs at, so the stored pick is always one it can use.
            effortChoice: effortChoice && body.effort,
            desktopDeviceId: backgroundExecutorDeviceId(body),
          },
        })
        // Admission committed. A failure to attach this HTTP sink must leave the turn recoverable.
        sendClaim = undefined
      }
      const stream = createSSEStream({
        requestPayload,
        admittedRun,
        userId: authenticatedUserId,
        streamId: userMessageId,
        executionId,
        runId,
        chatId: actualChatId,
        currentChat,
        message: body.message,
        titleModel: branch.titleModel,
        ...(branch.titleProvider ? { titleProvider: branch.titleProvider } : {}),
        requestId,
        workspaceId,
        ...(branch.kind === 'organization' ? { organizationId: branch.organizationId } : {}),
        otelRoot: activeOtelRoot,
        orchestrateOptions: {
          userId: authenticatedUserId,
          ...(branch.kind === 'workflow' ? { workflowId: branch.workflowId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(branch.kind === 'organization' ? { organizationId: branch.organizationId } : {}),
          chatId: actualChatId,
          executionId,
          runId,
          goRoute: branch.goRoute,
          autoExecuteTools: true,
          interactive: true,
          // Executor routing is decided HERE, once per turn, from the caller's declared
          // capabilities — dispatch never discovers client absence by burning a grace timer.
          clientToolPickupExpected,
          desktopClaimsLocalReads: body.desktopCapabilities?.localReadClaims === true,
          executionContext,
          billingAttribution: executionContext.billingAttribution,
          onComplete: buildOnComplete({
            runController,
            chatId: actualChatId,
            userMessageId,
            requestId,
            workspaceId,
            notifyChatStatus: branch.notifyChatStatus,
            organizationId: branch.kind === 'organization' ? branch.organizationId : undefined,
            userId: authenticatedUserId,
            requestMode:
              body.mode === 'plan' ? 'plan' : body.mode === 'assistant' ? 'assistant' : 'agent',
            otelRoot,
          }),
          onError: buildOnError({
            runController,
            chatId: actualChatId,
            userMessageId,
            requestId,
            workspaceId,
            notifyChatStatus: branch.notifyChatStatus,
            organizationId: branch.kind === 'organization' ? branch.organizationId : undefined,
            userId: authenticatedUserId,
            requestMode:
              body.mode === 'plan' ? 'plan' : body.mode === 'assistant' ? 'assistant' : 'agent',
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
          mode: body.mode,
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
      // A stateless send also keeps its claim once streaming starts.
      sendClaim = undefined
      return new Response(stream, {
        headers: {
          ...SSE_RESPONSE_HEADERS,
          traceparent: rootTraceparent,
          ...(actualChatId ? { [MOTHERSHIP_CHAT_ID_HEADER]: actualChatId } : {}),
          ...(admittedRun?.desktopDeviceId
            ? { [MOTHERSHIP_DESKTOP_EXECUTOR_HEADER]: 'device' }
            : {}),
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

    const applicationError = asOrchestrationError(error)
    /* Another attempt with this id holds its claim and may admit the turn. Answer
       as a duplicate (naming this id), so the client keeps the message under it
       rather than reading a refusal it could edit into a second turn. */
    if (applicationError instanceof ChatSendSupersededError) {
      return NextResponse.json(
        { error: 'This message was already sent.', activeStreamId: userMessageId },
        { status: 409 }
      )
    }
    if (applicationError?.code === 'forbidden' || applicationError?.code === 'not_found') {
      return NextResponse.json({ error: 'Conversation access denied' }, { status: 403 })
    }
    if (applicationError) {
      return NextResponse.json(
        { error: applicationError.message },
        { status: statusForOrchestrationError(applicationError.code) }
      )
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
