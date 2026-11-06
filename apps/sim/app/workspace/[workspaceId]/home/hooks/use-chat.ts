import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isPendingDesktopScopeId } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type CopilotChatSteerBody,
  copilotChatAbortContract,
  copilotChatDismissSteeringContract,
  copilotChatSteerContract,
} from '@/lib/api/contracts/copilot'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'
import {
  addMothershipChatResourceContract,
  removeMothershipChatResourceContract,
  reorderMothershipChatResourcesContract,
} from '@/lib/api/contracts/mothership-chats'
import type { MothershipTableViewContext } from '@/lib/api/contracts/mothership-resources'
import { useSession } from '@/lib/auth/client'
import { buildResourceAttachments } from '@/lib/browser-agent/attachments'
import { cancelActiveBrowserTools, initBrowserAgentTransport } from '@/lib/browser-agent/transport'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { readSSELines } from '@/lib/core/utils/sse'
import { getDesktopBridge, getDesktopChatCapabilities } from '@/lib/desktop'
import {
  activateDesktopChatScopes,
  desktopChatScopeId,
  discardDesktopChatScopes,
  migrateDesktopChatScopes,
  PENDING_CHAT_KEY_PREFIX,
} from '@/lib/desktop/chat-scope'
import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import {
  isUnsettledToolState,
  type PersistedFileAttachment,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'
import {
  type RevealedSimKeysByMessage,
  restoreRevealedSimKeysForMessage,
} from '@/lib/mothership/chat/sim-key-redaction'
import {
  MOTHERSHIP_CHAT_API_PATH,
  MOTHERSHIP_CHAT_ID_HEADER,
  MOTHERSHIP_DESKTOP_EXECUTOR_HEADER,
  MOTHERSHIP_STREAM_REPLAY_HEADER,
} from '@/lib/mothership/constants'
import { sendMothershipMessage } from '@/lib/mothership/events'
import type { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import { resolveMothershipModelSettings } from '@/lib/mothership/model-options'
import {
  isTerminalStreamStatus,
  parsePersistedStreamEventEnvelopeJson,
} from '@/lib/mothership/request/session/contract'
import type { FilePreviewSession } from '@/lib/mothership/request/session/file-preview-session-contract'
import { canDisplayResource } from '@/lib/mothership/resources/availability'
import { ResourcePersistenceQueue } from '@/lib/mothership/resources/client-persistence-queue'
import {
  type ChatResourceAddress,
  chatResourceKeyFor,
  getChatResourceSelectionId,
  isAddressableResource,
  isEphemeralResource,
  type MothershipResourceUpdate,
  mergeChatResource,
  reorderStoredChatResources,
  sanitizeChatResources,
} from '@/lib/mothership/resources/types'
import { executeBrowserToolOnClient } from '@/lib/mothership/tools/client/browser-tool-execution'
import { executeComputerToolOnClient } from '@/lib/mothership/tools/client/computer-tool-execution'
import {
  bindRunToolToExecution,
  executeRunToolOnClient,
  stopRunToolExecutions,
} from '@/lib/mothership/tools/client/run-tool-execution'
import { executeTerminalToolOnClient } from '@/lib/mothership/tools/client/terminal-tool-execution'
import { setCurrentChatTraceparent } from '@/lib/mothership/tools/client/trace-context'
import { isWorkflowToolName } from '@/lib/mothership/tools/client-executed-tools'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'
import { initTerminalTransport } from '@/lib/terminal/transport'
import { chatUrl } from '@/app/workspace/[workspaceId]/home/hooks/chat-url'
import {
  type DesktopToolSession,
  type DesktopToolTurn,
  desktopToolSession,
  stopDesktopTools,
} from '@/app/workspace/[workspaceId]/home/hooks/desktop-tool-lifetimes'
import {
  admittedMessageIds,
  adoptOrphanRow,
  afterDispositionRead,
  afterRetry,
  afterUnsentAttempt,
  canSteer,
  deliveryOf,
  fromJournaled,
  handedOffJournalKey,
  hasOutgoingFollowUp,
  holdAfterErroredTurn,
  isDeliveredAsTurn,
  MAX_OUTGOING_DELIVERY_ATTEMPTS,
  nextOutgoingStep,
  nextOutgoingWake,
  notSteered,
  type OutgoingMessage,
  optimisticUserMessageFor,
  orphanSteeringRows,
  outgoingRetryDelay,
  type SteeringOutcome,
  toHandedOff,
  toJournaled,
  toMessageContexts,
} from '@/app/workspace/[workspaceId]/home/hooks/outgoing-state'
import { useFilePreviewController } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import {
  captureResourceActivityScope,
  clearResourceActivityScope,
  clearTrackedResourceActivity,
  createResourceActivityTracker,
  excludeActivityOwnedBy,
  type ResourceActivityTracker,
  setTrackedBrowserRun,
  trackTerminalToolCall,
} from '@/app/workspace/[workspaceId]/home/hooks/resource-activity'
import { sendPayload } from '@/app/workspace/[workspaceId]/home/hooks/send-payload'
import {
  appliedSteeringIds,
  placeSteeredMessages,
} from '@/app/workspace/[workspaceId]/home/hooks/steered-messages'
import {
  applyTurnTerminal,
  createStreamLoopContext,
  dispatchStreamEvent,
  finalizeResidualToolCalls,
} from '@/app/workspace/[workspaceId]/home/hooks/stream'
import { useChatPlanRequired } from '@/app/workspace/[workspaceId]/home/hooks/use-chat-plan-required'
import { useNativeActiveTabIds } from '@/app/workspace/[workspaceId]/home/hooks/use-desktop-tab-resources'
import { useMothershipChatOlderMessages } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-chat-older-messages'
import { resolveEffectiveResourceId } from '@/app/workspace/[workspaceId]/home/resource-view-policy'
import {
  fetchMothershipChatActiveStreamId,
  fetchMothershipChatHistory,
  type MothershipChatHistory,
  mothershipChatKeys,
  saveMothershipChatEffort,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { fetchWorkflowEnvelope } from '@/hooks/queries/utils/fetch-workflow-envelope'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { getQueryClient } from '@/hooks/queries/utils/get-query-client'
import { invalidateWorkflowSelectors } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { snapAllSmoothText } from '@/hooks/use-smooth-text'
import { useChatPanelStore } from '@/stores/chat-panel/store'
import { useChatPlanModalStore } from '@/stores/modals/chat-plan/store'
import {
  useMothershipEffortStore,
  useMothershipPlanEffortStore,
} from '@/stores/mothership-effort/store'
import { useMothershipOutgoingStore } from '@/stores/mothership-outgoing/store'
import type { ChatContext } from '@/stores/panel'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type {
  ChatMessage,
  ChatRequestMode,
  ContentBlock,
  FileAttachmentForApi,
  MothershipResource,
  SendPayload,
  ToolCallInfo,
} from '../types'
import {
  buildAssistantSnapshotMessage,
  buildChatHistoryHydrationKey,
  getReplayCompletedWorkflowToolCallIds,
  hasTerminalPersistedAssistantForStream,
  markMessageStopped,
  type ReconnectReplaySelection,
  reconcileLiveAssistantTurn,
  selectReconnectReplayState,
} from './message-reconcile'
import {
  buildReplayStream,
  createStreamSchemaValidationError,
  isAlreadyProcessedStreamCursor,
  isStreamGoneError,
  isStreamSchemaValidationError,
  parseStreamBatchResponse,
  resolveChatIdFromStreamBatch,
  type StreamBatchResponse,
  StreamGoneError,
} from './stream-protocol'

export interface SendMessageOptions {
  /**
   * Message id of a prior attempt this send retries, set when recovering a send
   * an unmount cleanup withdrew. Reusing it lets the server deduplicate the two
   * attempts instead of opening a second chat.
   */
  resumeUserMessageId?: string
  /** Assistant searches the workspace and acts through the caller's connected accounts. */
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
  assistantSearchLevel?: AssistantSearchLevel
}

interface FinalizeOptions {
  error?: boolean
  targetChatId?: string
  /** A lost transport must remain recoverable while the server is still running. */
  streamTerminal?: boolean
}

/**
 * Why the hook re-attaches to the chat's running turn: the browser returned
 * (`pageshow`, `visible`, `online`), an exhausted reconnect rechecks, or a send
 * was refused because that turn holds the chat.
 */
type ActiveStreamRecoveryReason =
  | 'pageshow'
  | 'visible'
  | 'online'
  | 'exhausted_recheck'
  | 'busy_refusal'

/**
 * A send handed back to its caller instead of becoming a turn, under the id
 * (`userMessageId`) a retry reuses so the server deduplicates the attempts:
 * - `withdrawn`: an unmount cleanup aborted it before the server answered;
 * - `unsent`: its POST got no answer, so the server may or may not hold it;
 * - `busy`: another turn (`streamId`) holds the chat, so it can steer that one.
 */
type WithdrawnSendResult =
  | { userMessageId: string; reason: 'withdrawn' | 'unsent' }
  | { userMessageId: string; reason: 'busy'; streamId: string }

/**
 * `true` when the send owns the transcript (rendered, or handed to reconnect),
 * `false` when nothing went out, and the object form when it was handed back.
 */
type StartSendMessageResult = boolean | WithdrawnSendResult

interface StartSendMessageOptions {
  /**
   * The id this send goes out under, when it is not a fresh message: a send an
   * unmount withdrew, or a message steering handed on as its own turn. Reusing
   * it lets the server deduplicate the attempts instead of billing a second turn.
   */
  userMessageId?: string
  /** It was sent into a turn that did not apply it; the server settles that before admitting it. */
  steeringFallback?: boolean
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
  assistantSearchLevel?: AssistantSearchLevel
}

/** Stop must preserve send admission even when it precedes the first response byte. */
interface PendingChatAdmission {
  userMessageId: string
  chatKey: string
  controller: AbortController
  settled: Promise<string | undefined>
  /** What an unmount would withdraw, if it ran before the server answered. */
  send: WithdrawnSend
}

/** A send an unmount cleanup withdrew, as handed to the next chat surface. */
interface WithdrawnSend extends SendPayload {
  userMessageId: string
}

export interface UseChatReturn {
  messages: ChatMessage[]
  isChatHistoryPending: boolean
  isSending: boolean
  isReconnecting: boolean
  error: string | null
  resolvedChatId: string | undefined
  /** Existing chat id, or the short-lived provisional scope before first send. */
  desktopScopeId: string
  sendMessage: (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    options?: SendMessageOptions
  ) => Promise<void>
  stopGeneration: () => Promise<void>
  resources: MothershipResource[]
  activeResourceId: string | null
  setActiveResourceId: (id: string | null) => void
  addResource: (resource: MothershipResourceUpdate) => boolean
  setTableViewContext: (tableId: string, context: MothershipTableViewContext) => void
  removeResource: (resource: ChatResourceAddress) => void
  reorderResources: (resources: MothershipResource[]) => void
  /** Tries again to deliver a message shown as not delivered. */
  retryMessage: (id: string) => void
  dismissMessage: (id: string) => void
  previewSession: FilePreviewSession | null
  getCurrentRequestId: () => string | undefined
}

const RECONNECT_TAIL_ERROR =
  'Live reconnect failed before the stream finished. The latest response may be incomplete.'
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_EXHAUSTED_RECHECK_MS = 30_000
const STREAM_BATCH_FETCH_TIMEOUT_MS = 10_000
/** Both live transports heartbeat every 15s; three missed heartbeats trigger cursor recovery. */
const STREAM_IDLE_TIMEOUT_MS = 45_000
const STREAM_CHAT_ID_RESOLVE_TIMEOUT_MS = 10_000
const CHAT_HISTORY_RECOVERY_TIMEOUT_MS = 10_000
/** Backoff for re-reading a transcript the server has not yet saved a finished turn into. */
const PERSISTED_TURN_REFETCH_BASE_MS = 250
const PERSISTED_TURN_REFETCH_MAX_DELAY_MS = 5_000
/** How long a finished turn's save is waited for; a slow save still lands well inside it. */
const PERSISTED_TURN_WAIT_MS = 120_000
/** How long a Stop's abort request may take before the Stop counts as failed. */
const STOP_REQUEST_TIMEOUT_MS = 15_000
const DETACHED_CHAT_RETRY_BASE_MS = 1000
const DETACHED_CHAT_RETRY_MAX_MS = 30_000

/** Longer than the steer route's own retries of an unknown run or a full budget. */
const STEER_REQUEST_TIMEOUT_MS = 20_000

const logger = createLogger('useChat')

/**
 * The reconnect query for a stream. Once a stream was re-synced from the worker's log,
 * its cursors are log positions, so every later read names the log as its source and
 * is never served from the replay ring, even one that restarted and grew past them.
 */
function streamReconnectQuery(streamId: string, afterCursor: string, fromLog: boolean): string {
  return `streamId=${encodeURIComponent(streamId)}&after=${encodeURIComponent(afterCursor)}${fromLog ? '&source=log' : ''}`
}

/**
 * Fire-and-forget desktop-surface handoff between chat scopes: drops an
 * abandoned pending scope (never a durable one) before activating the next.
 * Failures are swallowed — scope lifecycle must never block chat navigation.
 */
function transitionDesktopScopes(
  previousScopeId: string,
  nextScopeId: string,
  canDiscardPrevious = true
): void {
  void (async () => {
    if (
      canDiscardPrevious &&
      isPendingDesktopScopeId(previousScopeId) &&
      previousScopeId !== nextScopeId
    ) {
      await discardDesktopChatScopes(previousScopeId)
    }
    await activateDesktopChatScopes(nextScopeId)
  })().catch(() => {})
}

type ActiveTurn = {
  userMessageId: string
  assistantMessageId: string
  optimisticUserMessage: ChatMessage
  optimisticAssistantMessage: ChatMessage
  pendingChatKey: string
  desktopScopeId: string
}

interface CompletedTurn {
  chatId: string
  userMessage: PersistedMessage
  assistantMessage: PersistedMessage
}

function retainCompletedTurn(
  messages: PersistedMessage[],
  turn: CompletedTurn
): PersistedMessage[] {
  const withOwner = messages.some((message) => message.id === turn.userMessage.id)
    ? messages
    : [...messages, turn.userMessage]
  return reconcileLiveAssistantTurn({
    messages: withOwner,
    streamId: turn.userMessage.id,
    liveAssistant: turn.assistantMessage,
    activeStreamId: null,
  })
}

interface DetachedChatResolution {
  chatId?: string
  terminal: boolean
}

function createTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController === 'undefined') return undefined

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Operation timed out after ${ms}ms`))
  }, ms)
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true })
  return controller.signal
}

function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals)
  }
  if (typeof AbortController === 'undefined') return activeSignals[0]

  const controller = new AbortController()
  const abortFromSource = (source: AbortSignal) => {
    cleanup()
    controller.abort(source.reason)
  }
  const listeners = activeSignals.map((signal) => {
    const listener = () => abortFromSource(signal)
    signal.addEventListener('abort', listener, { once: true })
    return { signal, listener }
  })
  function cleanup() {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener('abort', listener)
    }
  }
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFromSource(signal)
      break
    }
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  return controller.signal
}

function createAbortError(signal: AbortSignal): Error {
  const error = new Error(signal.reason ? String(signal.reason) : 'Operation aborted')
  error.name = 'AbortError'
  return error
}

async function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (!signal) {
    await sleep(ms)
    return
  }
  if (signal.aborted) throw createAbortError(signal)

  let cleanup: (() => void) | undefined
  await Promise.race([
    sleep(ms),
    new Promise<never>((_, reject) => {
      const onAbort = () => reject(createAbortError(signal))
      cleanup = () => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  ]).finally(() => cleanup?.())
}

/** Resolves a detached stream until it has a durable chat owner or reaches a terminal state. */
export async function waitForDetachedChatResolution(
  resolve: () => Promise<DetachedChatResolution>,
  signal: AbortSignal
): Promise<DetachedChatResolution> {
  let attempt = 1
  while (true) {
    if (signal.aborted) throw createAbortError(signal)
    const resolution = await resolve()
    if (signal.aborted) throw createAbortError(signal)
    if (resolution.chatId || resolution.terminal) return resolution
    await sleepWithAbort(
      backoffWithJitter(attempt, null, {
        baseMs: DETACHED_CHAT_RETRY_BASE_MS,
        maxMs: DETACHED_CHAT_RETRY_MAX_MS,
      }),
      signal
    )
    attempt++
  }
}

/** The abort reason of the user's Stop. */
const USER_STOP_ABORT_REASON = 'user_stop:client_stopGeneration'

/**
 * Runs a browser tool on the desktop client. The agent's tab reaches the
 * resource strip through the desktop tab list, so nothing is opened here.
 * Replay/exactly-once guarding lives in executeBrowserToolOnClient
 * (sessionStorage-backed, so reloads cannot re-run an action).
 */
function startClientBrowserTool(
  toolCallId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  scopeId: string,
  eventTs?: string,
  desktopTurn?: DesktopToolTurn
): void {
  if (!isCurrentBrowserToolName(toolName)) return
  const lease = desktopTurn?.lease()
  void executeBrowserToolOnClient(
    toolCallId,
    toolName,
    toolArgs,
    scopeId,
    eventTs,
    lease?.signal
  ).finally(() => lease?.release())
}

/**
 * Runs a terminal tool on the desktop client. The agent's shell reaches the
 * resource strip through the desktop tab list, so nothing is opened here.
 * Replay/exactly-once guarding lives in executeTerminalToolOnClient
 * (sessionStorage-backed, so reloads cannot re-run a command).
 */
function startClientTerminalTool(
  toolCallId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  scopeId: string,
  eventTs?: string
): void {
  if (!isTerminalToolName(toolName)) return
  executeTerminalToolOnClient(toolCallId, toolArgs, scopeId, eventTs)
}

function buildRecoverySubjectKey(
  chatId: string | undefined,
  selectedChatId: string | undefined
): string {
  return `${chatId ?? ''}:${selectedChatId ?? ''}`
}

/** Adds a workflow to the React Query cache with a top-insertion sort order if it doesn't already exist. */
function ensureWorkflowInRegistry(resourceId: string, title: string, workspaceId: string): boolean {
  const workflows = getWorkflows(workspaceId)
  if (workflows.some((w) => w.id === resourceId)) return false
  const sortOrder = getTopInsertionSortOrder(
    Object.fromEntries(workflows.map((w) => [w.id, w])),
    getFolderMap(workspaceId),
    workspaceId,
    null
  )
  const newMetadata: WorkflowMetadata = {
    id: resourceId,
    name: title,
    lastModified: new Date(),
    createdAt: new Date(),
    workspaceId,
    folderId: null,
    sortOrder,
  }
  const queryClient = getQueryClient()
  const key = workflowKeys.list(workspaceId, 'active')
  queryClient.setQueryData<WorkflowMetadata[]>(key, (current) => {
    const next = current ?? workflows
    if (next.some((workflow) => workflow.id === resourceId)) {
      return next
    }

    return [...next, newMetadata]
  })
  void invalidateWorkflowSelectors(queryClient, workspaceId)
  return true
}

/**
 * Hydrated workflow resources whose workflow exists neither in the fetched
 * server list nor in the local cache. The cache term protects a workflow the
 * agent created after the list snapshot was taken — the stream's registry
 * insert lands it in the cache before any refetch does.
 */
export function selectDeletedWorkflowResources(
  workflowResources: MothershipResource[],
  fetchedWorkflowIds: ReadonlySet<string>,
  cachedWorkflows: readonly WorkflowMetadata[]
): MothershipResource[] {
  const cachedIds = new Set(cachedWorkflows.map((workflow) => workflow.id))
  return workflowResources.filter(
    (resource) => !fetchedWorkflowIds.has(resource.id) && !cachedIds.has(resource.id)
  )
}

export interface ResourceEventOptions {
  activate?: boolean
  tableViewId?: string
}

export type ResourceEventHandler = (resourceId: string, options?: ResourceEventOptions) => void

/**
 * Whether a streamed resource event requests activation of its tab. The view
 * may still preserve an explicit user collapse or selection and surface the
 * event through an activity marker instead.
 */
export function shouldActivateResourceEvent(
  _activeResourceId: string | null,
  _resourceId: string,
  options?: ResourceEventOptions
): boolean {
  return options?.activate !== false
}

export interface UseChatOptions {
  /** Lets an embedded surface keep its own URL when a new chat is admitted. */
  onChatIdResolved?: (chatId: string) => void
  /** Intent for new turns; persisted chat intent remains authoritative on reload. */
  requestMode?: ChatRequestMode
  /** Build the admitted conversation URL from the owning surface's current view state. */
  getChatUrl?: (chatId: string) => string
  onResourceEvent?: ResourceEventHandler
  apiPath?: string
  stopPath?: string
  workflowId?: string
  onToolResult?: (toolName: string, success: boolean, result: unknown) => void
  onTitleUpdate?: () => void
  onStreamEnd?: (chatId: string, messages: ChatMessage[]) => void
  initialActiveResourceId?: string | null
  /**
   * Controlled binding for the active resource id, supplied as a
   * `[value, setValue]` tuple (e.g. a URL-backed nuqs `useQueryState`). When
   * provided, it is the single source of truth for the selected resource — the
   * hook reads and writes it directly instead of owning the state internally,
   * so no effect-sync mirror is needed. When omitted, `useChat` owns the state
   * via local `useState` (seeded from `initialActiveResourceId`); this is the
   * mode used by the socket-synced workflow editor copilot, whose resource
   * selection intentionally stays out of the URL.
   */
  activeResourceState?: [string | null, Dispatch<SetStateAction<string | null>>]
  /**
   * Whether this surface projects the desktop app's browser and terminal tabs
   * into its resources. Only then does the shown resource depend on which tab
   * the desktop app displays.
   */
  projectsDesktopTabs?: boolean
  /** Fired when the server's `traceparent` response header arrives, before any stream content. */
  onRequestStarted?: (info: { requestId: string; userMessageId: string }) => void
  /**
   * Whether a pathname is the surface's new-chat route, where a chat this mount admitted resets.
   * Defaults to the `/home` routes; a host with its own URLs names its route here.
   */
  isNewChatRoute?: (pathname: string) => boolean
}

interface ActiveStreamRecovery {
  subjectKey: string
  controller: AbortController
  promise: Promise<void>
}

export function getMothershipUseChatOptions(
  options: Pick<
    UseChatOptions,
    | 'onResourceEvent'
    | 'onStreamEnd'
    | 'initialActiveResourceId'
    | 'activeResourceState'
    | 'onRequestStarted'
    | 'requestMode'
    | 'getChatUrl'
    | 'isNewChatRoute'
  > = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    projectsDesktopTabs: true,
    ...options,
  }
}

export function getWorkflowCopilotUseChatOptions(
  options: Pick<
    UseChatOptions,
    'workflowId' | 'onToolResult' | 'onTitleUpdate' | 'onStreamEnd' | 'onRequestStarted'
  > = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    ...options,
  }
}

export function useChat(
  owner: string | { organizationId: string },
  initialChatId?: string,
  options?: UseChatOptions
): UseChatReturn {
  const modelSelectorEnabled = useFeatureFlag('mothership-model-selector')
  const computerUseEnabled = useFeatureFlag('mothership-computer-use')
  const workspaceId = typeof owner === 'string' ? owner : undefined
  const organizationId = typeof owner === 'string' ? undefined : owner.organizationId
  const scopeKey = typeof owner === 'string' ? owner : `organization:${owner.organizationId}`
  const session = useSession()
  const viewerId = session.data?.user?.id
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const chatPlanRequired = useChatPlanRequired()
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([])
  const [completedTurn, setCompletedTurn] = useState<CompletedTurn | null>(null)
  const completedTurnRef = useRef<CompletedTurn | null>(null)
  const updateCompletedTurn = useCallback((turn: CompletedTurn | null) => {
    // A follow-up send can start before React commits the completed turn.
    completedTurnRef.current = turn
    setCompletedTurn(turn)
  }, [])
  const [isSending, setIsSending] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState<string | undefined>(initialChatId)
  const onChatIdResolvedRef = useRef(options?.onChatIdResolved)
  onChatIdResolvedRef.current = options?.onChatIdResolved
  const [resources, setResources] = useState<MothershipResource[]>([])
  const internalActiveResourceState = useState<string | null>(
    options?.initialActiveResourceId ?? null
  )
  /**
   * Prefer a caller-supplied controlled binding (URL-backed nuqs on the home/Chat
   * surface) so the URL is the single source of truth; fall back to internal state
   * for the workflow editor copilot, which keeps resource selection out of the URL.
   */
  const [activeResourceId, setActiveResourceId] =
    options?.activeResourceState ?? internalActiveResourceState
  const onResourceEventRef = useRef(options?.onResourceEvent)
  const getChatUrlRef = useRef(options?.getChatUrl)
  getChatUrlRef.current = options?.getChatUrl
  const revealedSimKeysRef = useRef<RevealedSimKeysByMessage | null>(null)
  const revealedSimKeys = (revealedSimKeysRef.current ??= new Map())
  onResourceEventRef.current = options?.onResourceEvent
  const apiPathRef = useRef(options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH)
  apiPathRef.current = options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH
  const stopPathRef = useRef(options?.stopPath ?? '/api/mothership/chat/stop')
  stopPathRef.current = options?.stopPath ?? '/api/mothership/chat/stop'
  const pendingStopPromiseRef = useRef<Promise<void> | null>(null)
  const workflowIdRef = useRef(options?.workflowId)
  workflowIdRef.current = options?.workflowId
  const onToolResultRef = useRef(options?.onToolResult)
  onToolResultRef.current = options?.onToolResult
  const onTitleUpdateRef = useRef(options?.onTitleUpdate)
  onTitleUpdateRef.current = options?.onTitleUpdate
  const onStreamEndRef = useRef(options?.onStreamEnd)
  onStreamEndRef.current = options?.onStreamEnd
  const onRequestStartedRef = useRef(options?.onRequestStarted)
  onRequestStartedRef.current = options?.onRequestStarted

  const getCurrentRequestId = useCallback(() => {
    const traceId = streamTraceparentRef.current?.split('-')[1] ?? ''
    return /^[0-9a-f]{32}$/.test(traceId) ? traceId : undefined
  }, [])

  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  /**
   * Stored resources this client cannot display — the desktop-only panels when
   * there is no bridge. Held so they survive a session that never shows them:
   * a reorder sends the full stored set, and the server rejects one that does
   * not match what it has, so leaving them out would both break reordering and
   * make the tabs disappear for the desktop app too.
   */
  const undisplayableResourcesRef = useRef<MothershipResource[]>([])
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  const resourcePersistenceQueueRef = useRef<ResourcePersistenceQueue | null>(null)
  const pendingResourceReordersRef = useRef<Map<string, MothershipResource[]> | null>(null)
  const pendingResourceReorders = (pendingResourceReordersRef.current ??= new Map())
  const pendingResourceReorderFlushesRef = useRef<Map<string, Promise<void>> | null>(null)
  const pendingResourceReorderFlushes = (pendingResourceReorderFlushesRef.current ??= new Map())
  const refreshResourceHistory = useCallback(
    async (chatId: string) => {
      /** Cancel pre-write reads without rolling back newer optimistic changes. */
      const query = { queryKey: mothershipChatKeys.detail(chatId), exact: true }
      await queryClient.cancelQueries(query, { revert: false })
      queryClient.setQueryData<MothershipChatHistory>(query.queryKey, (current) => {
        const queue = resourcePersistenceQueueRef.current
        if (!current || !queue) return current
        const resources = queue.applyPendingUpdates(chatId, current.resources)
        const pendingOrder = pendingResourceReorders.get(chatId)
        return {
          ...current,
          resources: pendingOrder
            ? (reorderStoredChatResources(resources, pendingOrder, workspaceId) ?? resources)
            : resources,
        }
      })
      void queryClient.invalidateQueries(query)
    },
    [queryClient, workspaceId]
  )
  if (!resourcePersistenceQueueRef.current) {
    resourcePersistenceQueueRef.current = new ResourcePersistenceQueue({
      persist: async (chatId, update) => {
        const { clearViewId, ...resource } = update
        const result = await requestJson(addMothershipChatResourceContract, {
          body: {
            chatId,
            resource,
            ...(clearViewId === true ? { clearViewId: true as const } : {}),
          },
        })
        await refreshResourceHistory(chatId)
        return result
      },
      onError: (error) => {
        logger.warn('Failed to persist resource; will retry on next hydration', error)
      },
      chatWorkspaceId: () => workspaceIdRef.current,
    })
  }
  const resourcePersistenceQueue = resourcePersistenceQueueRef.current

  // Sentinel used while no `chatId` is resolved; `adoptResolvedChatId`
  // migrates this bucket onto the real chatId on first send. Rotated on
  // home reset so a new pending chat starts with an empty bucket.
  const pendingChatKeyRef = useRef<string>(`${PENDING_CHAT_KEY_PREFIX}${generateShortId()}`)
  const pendingDesktopScopeIdRef = useRef(
    desktopChatScopeId(scopeKey, undefined, pendingChatKeyRef.current)
  )
  const initialDesktopScopeId = desktopChatScopeId(
    scopeKey,
    initialChatId,
    pendingChatKeyRef.current
  )
  const desktopScopeIdRef = useRef(initialDesktopScopeId)
  const [desktopScopeId, setDesktopScopeId] = useState(initialDesktopScopeId)
  const nativeActiveTabIds = useNativeActiveTabIds(
    options?.projectsDesktopTabs ? desktopScopeId : null
  )

  const nativeActiveTabIdsRef = useRef(nativeActiveTabIds)
  nativeActiveTabIdsRef.current = nativeActiveTabIds

  // Derived for rendering rather than written back, so nothing the user did not
  // choose ever lands in their selection.
  const effectiveActiveResourceId = useMemo(
    () => resolveEffectiveResourceId(resources, activeResourceId, nativeActiveTabIds),
    [resources, activeResourceId, nativeActiveTabIds]
  )

  /** Keep the requested selection while the resource list is still loading. */
  const activeResourceIdRef = useRef(activeResourceId ?? effectiveActiveResourceId)
  activeResourceIdRef.current = activeResourceId ?? effectiveActiveResourceId
  const selectedResourceIdRef = useRef(activeResourceId)
  selectedResourceIdRef.current = activeResourceId
  const {
    previewSession,
    previewSessionRef,
    previewSessionsRef,
    activePreviewSessionIdRef,
    latestPreviewTargetToolCallIdRef,
    previewActivationOwnerRef,
    completedPreviewResourceHandoffRef,
    shouldAutoActivatePreviewSession,
    applyPreviewSessionUpdate,
    removePreviewSessionImmediate,
    reconcileTerminalPreviewSessions,
    resetEphemeralPreviewState,
    promoteFileResource,
    seedPreviewSessions,
    onPreviewPhase,
  } = useFilePreviewController({
    workspaceId,
    resourcesRef,
    setResources,
    setActiveResourceId,
    activeResourceIdRef,
    onResourceEventRef,
  })

  const upsertChatHistory = useCallback(
    (chatId: string, updater: (current: MothershipChatHistory) => MothershipChatHistory) => {
      queryClient.setQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId),
        (current) => {
          const base: MothershipChatHistory = current ?? {
            id: chatId,
            title: null,
            messages: [],
            activeStreamId: null,
            resources: resourcesRef.current,
          }
          return updater(base)
        }
      )
    },
    [queryClient]
  )

  const [chatKey, setChatKey] = useState<string>(initialChatId ?? pendingChatKeyRef.current)
  const chatKeyRef = useRef<string>(chatKey)
  chatKeyRef.current = chatKey
  /** Mirrors `outgoing` for code that runs between renders; written only by `writeOutgoing`. */
  const outgoingRef = useRef<OutgoingMessage[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([])
  const writeOutgoing = useCallback((update: (current: OutgoingMessage[]) => OutgoingMessage[]) => {
    const previous = outgoingRef.current
    outgoingRef.current = update(previous)
    setOutgoing(outgoingRef.current)
    /* A chat-bound key is the chat id, which outlives this mount; a provisional
       key dies with it, so only chats are journaled. */
    const touched = new Set(
      [...previous, ...outgoingRef.current]
        .map((message) => message.chatKey)
        .filter((key) => !key.startsWith(PENDING_CHAT_KEY_PREFIX))
    )
    const journal = useMothershipOutgoingStore.getState()
    for (const key of touched) {
      journal.record(
        key,
        outgoingRef.current.filter((message) => message.chatKey === key).map(toJournaled)
      )
    }
  }, [])
  /** Moves the messages a new chat's provisional key holds onto the chat it became. */
  const migrateOutgoing = useCallback(
    (fromKey: string, toKey: string) => {
      if (!outgoingRef.current.some((message) => message.chatKey === fromKey)) return
      writeOutgoing((current) =>
        current.map((message) =>
          message.chatKey === fromKey ? { ...message, chatKey: toKey } : message
        )
      )
    },
    [writeOutgoing]
  )
  /** Steering ids a turn this surface watched applied, read when that turn's end settles them. */
  const appliedSteeringIdsRef = useRef<Set<string> | null>(null)
  const appliedSteeringIdsSeen = (appliedSteeringIdsRef.current ??= new Set())
  /** Turns this surface saw end, which no stale history read can make look running again. */
  const endedStreamIdsRef = useRef<Set<string> | null>(null)
  const endedStreamIds = (endedStreamIdsRef.current ??= new Set())
  /** Turns this surface saw end in an error: what they held does not go out on its own. */
  const erroredStreamIdsRef = useRef<Set<string> | null>(null)
  const erroredStreamIds = (erroredStreamIdsRef.current ??= new Set())
  /** The settle-then-send pass running now; `again` asks it to go round once more. */
  const outgoingDeliveryRef = useRef<{ pass: Promise<void> | null; again: boolean }>({
    pass: null,
    again: false,
  })
  const outgoingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The send each message went out as its own turn under, for `sendMessage` to await. */
  const outgoingTurnSendsRef = useRef<Map<string, Promise<StartSendMessageResult>> | null>(null)
  const outgoingTurnSends = (outgoingTurnSendsRef.current ??= new Map())
  const deliverOutgoingRef = useRef<() => void>(() => {})
  const pendingChatAdmissionRef = useRef<PendingChatAdmission | null>(null)
  const hasPendingChatAdmission = useCallback(
    () => pendingChatAdmissionRef.current?.chatKey === chatKeyRef.current,
    []
  )

  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: {
        preserveExistingState?: boolean
        resumeCursor?: string
        deferFlushes?: boolean
        suppressedWorkflowToolStartIds?: ReadonlySet<string>
        targetChatId?: string
        shouldContinue?: () => boolean
      }
    ) => Promise<{ sawStreamError: boolean; sawComplete: boolean; inputApplied?: boolean }>
  >(async () => ({ sawStreamError: false, sawComplete: false }))
  const retryReconnectRef = useRef<
    (opts: {
      streamId: string
      assistantId: string
      gen: number
      targetChatId?: string
      shouldContinue?: () => boolean
    }) => Promise<boolean>
  >(async () => false)
  const resolveDetachedChatForStreamRef = useRef<
    (streamId: string, signal?: AbortSignal) => Promise<DetachedChatResolution>
  >(async () => ({ terminal: false }))
  const finalizeRef = useRef<(options?: FinalizeOptions) => void>(() => {})
  const recoverActiveStreamRef = useRef<(reason: ActiveStreamRecoveryReason) => Promise<void>>(
    async () => {}
  )
  const reconnectExhaustedRecheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const detachedChatResolutionControllersRef = useRef<Set<AbortController> | null>(null)
  const detachedChatResolutionControllers = (detachedChatResolutionControllersRef.current ??=
    new Set())
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  /** Cleared on unmount, so late async work cannot act on a surface the user left. */
  const surfaceMountedRef = useRef(true)
  const desktopToolsRef = useRef<DesktopToolSession | null>(null)
  const desktopTools = (desktopToolsRef.current ??= desktopToolSession())
  useEffect(() => {
    surfaceMountedRef.current = true
    return () => {
      surfaceMountedRef.current = false
    }
  }, [])
  /* The new-chat effort pick belongs to this surface, not to one composer: it outlives the swap
     from the empty-state composer to the chat view during a first send, so a withdrawn send
     leaves it in place. It drops when the surface unmounts or switches chats, and when it adopts
     a chat (`adoptResolvedChatId`). */
  useEffect(() => {
    if (initialChatId) return
    return () => useMothershipEffortStore.getState().setNewChatEffort(null)
  }, [initialChatId])
  const tableViewContextsRef = useRef({
    scopeId: desktopScopeId,
    views: new Map<string, MothershipTableViewContext>(),
  })
  if (tableViewContextsRef.current.scopeId !== desktopScopeId) {
    tableViewContextsRef.current = { scopeId: desktopScopeId, views: new Map() }
  }
  for (const tableId of tableViewContextsRef.current.views.keys()) {
    if (!resources.some((resource) => resource.type === 'table' && resource.id === tableId)) {
      tableViewContextsRef.current.views.delete(tableId)
    }
  }
  /** A message's contexts with each table naming the view the user has open, as sent. */
  const withTableViews = useCallback(
    (contexts: ChatContext[]): ChatContext[] =>
      contexts.map((context) =>
        context.kind === 'table' &&
        !context.currentView &&
        tableViewContextsRef.current.views.has(context.tableId)
          ? { ...context, currentView: tableViewContextsRef.current.views.get(context.tableId) }
          : context
      ),
    []
  )
  const setTableViewContext = useCallback(
    (tableId: string, context: MothershipTableViewContext) => {
      if (tableViewContextsRef.current.scopeId !== desktopScopeId) return
      if (
        !resourcesRef.current.some(
          (resource) => resource.type === 'table' && resource.id === tableId
        )
      )
        return
      tableViewContextsRef.current.views.set(tableId, context)
    },
    [desktopScopeId]
  )

  /** Panel/chat selection — drives createNewChat + request chatId; may differ from chatIdRef while a stream is still finishing. */
  const selectedChatIdRef = useRef<string | undefined>(initialChatId)
  selectedChatIdRef.current = initialChatId
  const appliedChatHistoryKeyRef = useRef<string | undefined>(undefined)
  const activeTurnRef = useRef<ActiveTurn | null>(null)
  const pendingUserMsgRef = useRef<PersistedMessage | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  // W3C traceparent from the chat POST response; echoed on
  // abort/stop/confirm/replay so side-channel calls join the same
  // trace instead of becoming disconnected roots.
  const streamTraceparentRef = useRef<string | undefined>(undefined)
  // The `request.id` from the active stream's trace events. Forwarded
  // to /chat/stop so the persisted aborted message carries it (keeps
  // the copy-request-ID button functional after refetch).
  const streamRequestIdRef = useRef<string | undefined>(undefined)
  const locallyTerminalStreamIdRef = useRef<string | undefined>(undefined)
  /** The finished stream whose saved transcript is being waited for, if any. */
  const persistedTurnWaitRef = useRef<{ streamId: string; controller: AbortController } | null>(
    null
  )
  const lastCursorRef = useRef('0')
  const logResyncedStreamIdRef = useRef<string | null>(null)
  const activeStreamReturnRecoveryRef = useRef<ActiveStreamRecovery | null>(null)
  const sendingRef = useRef(false)
  const streamGenRef = useRef(0)
  const resourceActivityTrackerRef = useRef<ResourceActivityTracker | null>(null)
  const streamingContentRef = useRef('')
  const streamingBlocksRef = useRef<ContentBlock[]>([])
  const handledClientWorkflowToolIdsRef = useRef<Set<string> | null>(null)
  const handledClientWorkflowToolIds = (handledClientWorkflowToolIdsRef.current ??= new Set())
  const handledClientLocalFilesystemToolIdsRef = useRef<Set<string> | null>(null)
  const handledClientLocalFilesystemToolIds = (handledClientLocalFilesystemToolIdsRef.current ??=
    new Set())
  const recoveringClientWorkflowToolIdsRef = useRef<Set<string> | null>(null)
  const recoveringClientWorkflowToolIds = (recoveringClientWorkflowToolIdsRef.current ??= new Set())
  const isHomePage = options?.isNewChatRoute
    ? options.isNewChatRoute(pathname)
    : pathname.endsWith('/home')

  const setTransportIdle = useCallback(() => {
    sendingRef.current = false
    setIsSending(false)
    setIsReconnecting(false)
  }, [])

  const setTransportStreaming = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(false)
  }, [])

  const setTransportReconnecting = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(true)
  }, [])

  const cancelActiveStreamRecovery = useCallback(() => {
    const recovery = activeStreamReturnRecoveryRef.current
    if (!recovery) return
    recovery.controller.abort('superseded_recovery')
    activeStreamReturnRecoveryRef.current = null
  }, [])

  const cancelActiveStreamReader = useCallback(() => {
    const reader = streamReaderRef.current
    streamReaderRef.current = null
    void reader?.cancel().catch((error) => {
      logger.warn('Failed to cancel detached stream reader', {
        error: toError(error).message,
      })
    })
  }, [])

  const resetStreamingBuffers = useCallback(() => {
    streamingContentRef.current = ''
    streamingBlocksRef.current = []
  }, [])

  const applyReconnectReplaySelection = useCallback(
    (streamId: string, afterCursor: string): ReconnectReplaySelection => {
      const selection = selectReconnectReplayState({
        afterCursor,
        currentContent: streamingContentRef.current,
        currentBlocks: streamingBlocksRef.current,
      })

      // A reset replays from cursor 0 into a fresh model that never reads
      // these refs — keep the previous snapshot visible (and stop-persistable)
      // until the replay's terminal flush overwrites it, instead of collapsing
      // the rendered message to empty.
      lastCursorRef.current = selection.afterCursor

      if (selection.afterCursor === '0' && afterCursor !== '0') {
        logger.info('Resetting stream replay cursor after reconnect state mismatch', {
          streamId,
          previousCursor: afterCursor,
        })
      }

      return selection
    },
    []
  )

  const clearActiveTurn = useCallback(() => {
    activeTurnRef.current = null
    pendingUserMsgRef.current = null
    streamIdRef.current = undefined
    streamRequestIdRef.current = undefined
    streamTraceparentRef.current = undefined
    setCurrentChatTraceparent(undefined)
    lastCursorRef.current = '0'
    resetStreamingBuffers()
  }, [resetStreamingBuffers])

  const resetHomeChatState = useCallback(() => {
    const abandonedDesktopScopeId = desktopScopeIdRef.current
    cancelActiveStreamRecovery()
    streamGenRef.current++
    cancelActiveStreamReader()
    chatIdRef.current = undefined
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    updateCompletedTurn(null)
    clearActiveTurn()
    setResolvedChatId(undefined)
    appliedChatHistoryKeyRef.current = undefined
    abortControllerRef.current = null
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    setActiveResourceId(null)
    // Pending view pins belong to the chat whose stream issued them.
    useTableViewPinStore.getState().reset()
    undisplayableResourcesRef.current = []
    resetEphemeralPreviewState()
    pendingChatKeyRef.current = `${PENDING_CHAT_KEY_PREFIX}${generateShortId()}`
    chatKeyRef.current = pendingChatKeyRef.current
    setChatKey(pendingChatKeyRef.current)
    const pendingDesktopScopeId = desktopChatScopeId(scopeKey, undefined, pendingChatKeyRef.current)
    pendingDesktopScopeIdRef.current = pendingDesktopScopeId
    desktopScopeIdRef.current = pendingDesktopScopeId
    setDesktopScopeId(pendingDesktopScopeId)
    transitionDesktopScopes(abandonedDesktopScopeId, pendingDesktopScopeId)
  }, [
    cancelActiveStreamRecovery,
    cancelActiveStreamReader,
    clearActiveTurn,
    updateCompletedTurn,
    resetEphemeralPreviewState,
    setTransportIdle,
    workspaceId,
    organizationId,
    scopeKey,
  ])

  const flushPendingResourceReorder = useCallback(
    (chatId: string): Promise<void> => {
      const activeFlush = pendingResourceReorderFlushes.get(chatId)
      if (activeFlush) return activeFlush

      const flush = async () => {
        while (true) {
          const pendingOrder = pendingResourceReorders.get(chatId)
          if (!pendingOrder) return
          if (resourcePersistenceQueue.hasPendingIdentityChanges(chatId)) return

          const inFlightWrites = resourcePersistenceQueue.getInFlightWrites(chatId)
          if (inFlightWrites.length > 0) {
            await Promise.allSettled(inFlightWrites)
            continue
          }

          if (pendingOrder.length === 0) {
            pendingResourceReorders.delete(chatId)
            return
          }
          try {
            await requestJson(reorderMothershipChatResourcesContract, {
              body: { chatId, resources: pendingOrder },
            })
            await refreshResourceHistory(chatId)
            if (pendingResourceReorders.get(chatId) === pendingOrder) {
              pendingResourceReorders.delete(chatId)
            }
          } catch (error) {
            // 400 is the server rejecting the body's identity set — a tab was
            // closed after this order was captured. Replaying it verbatim can
            // only fail again, so drop it and let the next reorder or hydration
            // re-establish the order. Everything else (offline, 401, 5xx) is
            // transient and keeps the body for the next retry.
            const unsatisfiable = isApiClientError(error) && error.status === 400
            if (unsatisfiable && pendingResourceReorders.get(chatId) === pendingOrder) {
              pendingResourceReorders.delete(chatId)
            }
            logger.warn(
              unsatisfiable
                ? 'Discarded a resource reorder the server rejected'
                : 'Failed to persist resource reorder; will retry on next hydration',
              error
            )
            return
          }
        }
      }
      const tracked = flush().finally(() => {
        if (pendingResourceReorderFlushes.get(chatId) === tracked) {
          pendingResourceReorderFlushes.delete(chatId)
        }
      })
      pendingResourceReorderFlushes.set(chatId, tracked)
      return tracked
    },
    [refreshResourceHistory, resourcePersistenceQueue]
  )

  const flushPendingResources = useCallback(
    async (chatId: string, sourceScopeId: string = chatId) => {
      if (resourcePersistenceQueue.getPendingResourceKeys(sourceScopeId).size > 0) {
        await resourcePersistenceQueue.flush(chatId, sourceScopeId)
      }
      await flushPendingResourceReorder(chatId)
    },
    [flushPendingResourceReorder, resourcePersistenceQueue]
  )

  const adoptResolvedChatId = useCallback(
    (chatId: string, options?: { replaceHomeHistory?: boolean; invalidateList?: boolean }) => {
      const selectedChatId = selectedChatIdRef.current
      const wasPending = !chatIdRef.current
      const activeTurn = activeTurnRef.current
      const pendingDesktopScopeId =
        wasPending && activeTurn && isPendingDesktopScopeId(activeTurn.desktopScopeId)
          ? activeTurn.desktopScopeId
          : pendingDesktopScopeIdRef.current
      const pendingChatKey =
        wasPending && activeTurn?.pendingChatKey.startsWith(PENDING_CHAT_KEY_PREFIX)
          ? activeTurn.pendingChatKey
          : pendingChatKeyRef.current
      chatIdRef.current = chatId
      const resolvedDesktopScopeId = desktopChatScopeId(scopeKey, chatId)
      if (wasPending) {
        useChatPanelStore.getState().migrate(pendingDesktopScopeId, resolvedDesktopScopeId)
        // Leaving the new chat. An admitted send has already moved the pick onto its chat; any
        // other way out (a Stop before admission, a recovered handoff) must not carry it into
        // the next new chat.
        useMothershipEffortStore.getState().setNewChatEffort(null)
      }
      const activeActivityTracker = resourceActivityTrackerRef.current
      if (activeActivityTracker?.generation === streamGenRef.current) {
        if (wasPending) {
          // Do not switch writes to the durable bucket until its async native
          // + renderer migration has completed; pre-populating it makes the
          // scoped-store migration treat the destination as conflicting.
          activeActivityTracker.scopeIds.add(resolvedDesktopScopeId)
        } else {
          captureResourceActivityScope(activeActivityTracker, resolvedDesktopScopeId)
        }
      }
      const migrateDesktopResources = wasPending
        ? migrateDesktopChatScopes(pendingDesktopScopeId, resolvedDesktopScopeId)
        : Promise.resolve()
      void migrateDesktopResources
        .then(() => {
          if (
            wasPending &&
            activeActivityTracker?.generation === streamGenRef.current &&
            resourceActivityTrackerRef.current === activeActivityTracker
          ) {
            captureResourceActivityScope(activeActivityTracker, resolvedDesktopScopeId)
          }
          // Migration crosses IPC. The user can select another chat while it
          // is in flight, so re-read the live selection before activating;
          // the value captured above is only valid for the synchronous state
          // updates in this call.
          const currentSelectedChatId = selectedChatIdRef.current
          if (!currentSelectedChatId || currentSelectedChatId === chatId) {
            desktopScopeIdRef.current = resolvedDesktopScopeId
            setDesktopScopeId(resolvedDesktopScopeId)
            return activateDesktopChatScopes(resolvedDesktopScopeId)
          }
        })
        .catch(() => {})
      // Migrate from the pending sentinel (not chatKeyRef — user may have
      // navigated to a different chat mid-stream, and we mustn't steal it).
      if (wasPending && pendingChatKey !== chatId) {
        migrateOutgoing(pendingChatKey, chatId)
      }
      // Only rebind chatKey if the user is still viewing the resolved chat.
      const stillViewingResolvedChat = !selectedChatId || selectedChatId === chatId
      if (stillViewingResolvedChat && chatKeyRef.current !== chatId) {
        chatKeyRef.current = chatId
        setChatKey(chatId)
      }
      if (!selectedChatId || selectedChatId === chatId) {
        setResolvedChatId(chatId)
      }
      if (
        options?.replaceHomeHistory &&
        !selectedChatId &&
        !workflowIdRef.current &&
        typeof window !== 'undefined'
      ) {
        if (onChatIdResolvedRef.current) {
          onChatIdResolvedRef.current(chatId)
        } else {
          window.history.replaceState(
            null,
            '',
            getChatUrlRef.current?.(chatId) ??
              chatUrl(
                organizationId ? { organizationId } : workspaceId!,
                chatId,
                requestModeRef.current
              )
          )
        }
      }
      if (options?.invalidateList) {
        queryClient.invalidateQueries<readonly unknown[]>({
          queryKey: organizationId
            ? mothershipChatKeys.organizationList(organizationId)
            : mothershipChatKeys.list(workspaceId),
        })
      }
      flushPendingResources(chatId, pendingChatKey)
    },
    [flushPendingResources, migrateOutgoing, queryClient, workspaceId, organizationId, scopeKey]
  )

  const {
    data: chatHistory,
    isPending: isChatHistoryPending,
    error: chatHistoryError,
  } = useMothershipChatHistory(resolvedChatId)
  useMothershipChatOlderMessages(resolvedChatId, chatHistory)
  const requestModeRef = useRef<ChatRequestMode>(
    options?.requestMode ?? (organizationId ? 'assistant' : 'agent')
  )
  requestModeRef.current =
    options?.requestMode ?? chatHistory?.mode ?? (organizationId ? 'assistant' : 'agent')
  const pendingTurn =
    chatHistory?.id === (initialChatId ?? chatIdRef.current) ? activeTurnRef.current : null
  const liveContent = streamingContentRef.current
  const liveBlocks = streamingBlocksRef.current
  const messages = useMemo(() => {
    const historyMessages =
      chatHistory && completedTurn?.chatId === chatHistory.id
        ? retainCompletedTurn(chatHistory.messages, completedTurn)
        : chatHistory?.messages
    const source = historyMessages?.map(toDisplayMessage) ?? [...pendingMessages]
    /** History reads can lag the live turn; retain both its owner and current response. */
    if (pendingTurn) {
      let ownerIndex = source.findIndex((message) => message.id === pendingTurn.userMessageId)
      if (ownerIndex < 0) {
        const assistantIndex = source.findIndex(
          (message) => message.id === pendingTurn.assistantMessageId
        )
        ownerIndex = assistantIndex < 0 ? source.length : assistantIndex
        source.splice(ownerIndex, 0, pendingTurn.optimisticUserMessage)
      }
      const assistant = source[ownerIndex + 1]
      const liveAssistant = {
        ...pendingTurn.optimisticAssistantMessage,
        content: liveContent,
        contentBlocks: liveBlocks,
      }
      if (assistant?.id === pendingTurn.assistantMessageId) {
        source[ownerIndex + 1] = { ...assistant, ...liveAssistant }
      } else if (assistant?.role !== 'assistant') {
        source.splice(ownerIndex + 1, 0, liveAssistant)
      }
    }
    const turnRunning = Boolean(pendingTurn) || Boolean(chatHistory?.activeStreamId)
    const outgoingMessages = outgoing.flatMap((message) =>
      message.chatKey === chatKey && message.status !== 'sending'
        ? [
            {
              message: {
                ...message.display,
                delivery: deliveryOf(message, turnRunning),
                ...(message.streamId ? { steering: { streamId: message.streamId } } : {}),
              },
              ...(message.streamId ? { streamId: message.streamId } : {}),
              ...(message.textOffset !== undefined ? { textOffset: message.textOffset } : {}),
            },
          ]
        : []
    )
    return placeSteeredMessages(source, outgoingMessages).map((m) =>
      restoreRevealedSimKeysForMessage(m, revealedSimKeys)
    )
  }, [
    chatHistory,
    pendingMessages,
    pendingTurn,
    liveContent,
    liveBlocks,
    completedTurn,
    outgoing,
    chatKey,
  ])
  const addResource = useCallback(
    (resourceUpdate: MothershipResourceUpdate): boolean => {
      // The single fan-in for tab creation, so the invariant lives here.
      if (!isAddressableResource(resourceUpdate)) {
        logger.warn('Ignored a resource with no id', {
          type: resourceUpdate.type,
          title: resourceUpdate.title,
        })
        return false
      }
      const keyOf = chatResourceKeyFor(workspaceId)
      const existing = resourcesRef.current.find((r) => keyOf(r) === keyOf(resourceUpdate))
      const resource = mergeChatResource(existing, resourceUpdate)
      const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
      if (persistChatId && !isEphemeralResource(resource)) {
        queryClient.setQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(persistChatId),
          (current) => {
            if (!current) return current
            const cached = current.resources.find((item) => keyOf(item) === keyOf(resource))
            const merged = mergeChatResource(cached, resourceUpdate)
            if (cached === merged) return current
            return {
              ...current,
              resources: cached
                ? current.resources.map((item) => (keyOf(item) === keyOf(resource) ? merged : item))
                : [...current.resources, merged],
            }
          }
        )
      }
      if (existing && resource === existing && resourceUpdate.clearViewId !== true) {
        return false
      }

      setResources((prev) => {
        const current = prev.find((r) => keyOf(r) === keyOf(resource))
        if (!current) return [...prev, resource]
        const merged = mergeChatResource(current, resourceUpdate)
        return merged === current
          ? prev
          : prev.map((r) => (keyOf(r) === keyOf(resource) ? merged : r))
      })
      // Synthetic result/preview panels are in-memory only. The browser tab
      // metadata is persisted even though its live page remains desktop-owned.
      if (isEphemeralResource(resource)) {
        return true
      }

      const persistenceScopeId = persistChatId ?? pendingChatKeyRef.current
      resourcePersistenceQueue.enqueue(resourceUpdate, persistChatId, persistenceScopeId, existing)
      return existing === undefined
    },
    [queryClient, resourcePersistenceQueue, workspaceId]
  )

  const removeResource = useCallback(
    (address: ChatResourceAddress) => {
      const keyOf = chatResourceKeyFor(workspaceId)
      const removedKey = keyOf(address)
      const matches = (resource: MothershipResource) => keyOf(resource) === removedKey
      const existing = resourcesRef.current.find(matches)
      // The open tab's own address, so a caller that only knows `type` and `id` still removes,
      // un-queues, and deletes the tab exactly as it was stored.
      const removed: ChatResourceAddress = existing ?? address
      const { type, id, workspaceId: resourceWorkspaceId, owner } = removed
      if (type === 'table') tableViewContextsRef.current.views.delete(id)
      setResources((prev) => prev.filter((r) => !matches(r)))
      const removedSelectionId = getChatResourceSelectionId(removed)
      setActiveResourceId((prev) => (prev === removedSelectionId ? null : prev))

      // Ephemeral panels were never persisted; nothing to delete server-side.
      if (isEphemeralResource(removed)) return

      const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
      const persistenceScopeId = persistChatId ?? pendingChatKeyRef.current
      if (persistChatId) {
        queryClient.setQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(persistChatId),
          (current) =>
            current && { ...current, resources: current.resources.filter((r) => !matches(r)) }
        )
      }
      const {
        inFlight: inFlightAdd,
        scheduleDelete,
        wasPending,
        wasPersisted,
      } = resourcePersistenceQueue.remove(
        removed,
        persistenceScopeId,
        Boolean(existing && persistChatId)
      )
      if (wasPending && !inFlightAdd && !wasPersisted) return

      if (!persistChatId) return
      scheduleDelete(persistChatId, async () => {
        const result = await requestJson(removeMothershipChatResourceContract, {
          body: {
            chatId: persistChatId,
            resourceType: type,
            resourceId: id,
            workspaceId: resourceWorkspaceId,
            owner,
          },
        })
        await refreshResourceHistory(persistChatId)
        return result
      })
    },
    [queryClient, refreshResourceHistory, resourcePersistenceQueue, workspaceId]
  )

  const discardPendingResourceUpsert = useCallback(
    (address: ChatResourceAddress) => {
      // An add queued before the chat id resolved stays in the provisional
      // bucket until a flush adopts it, so both scopes may hold it.
      const scopes = new Set([
        chatIdRef.current ?? selectedChatIdRef.current,
        pendingChatKeyRef.current,
      ])
      for (const scopeId of scopes) {
        if (scopeId) resourcePersistenceQueue.discardUpsert(address, scopeId)
      }
    },
    [resourcePersistenceQueue]
  )

  /**
   * Drops hydrated workflow tabs whose workflow no longer exists, so an old
   * chat cannot resurrect a deleted workflow. The workspace list is the fast
   * existence check; missing entries need an authorized detail read because a
   * personal delegation can also address another workspace. Persisted chat
   * resources alone never seed the sidebar. Confirmed 404s also remove the
   * resource from the stored chat so the tab stays gone next open.
   */
  const reconcileHydratedWorkflowResources = useCallback(
    async (chatId: string, workflowResources: MothershipResource[]) => {
      const byWorkspace = new Map<string, MothershipResource[]>()
      for (const resource of workflowResources) {
        const target = resource.workspaceId ?? workspaceId
        if (target) byWorkspace.set(target, [...(byWorkspace.get(target) ?? []), resource])
      }
      await Promise.all(
        [...byWorkspace].map(async ([targetWorkspaceId, scopedResources]) => {
          let existing: WorkflowMetadata[]
          try {
            existing = await getQueryClient().fetchQuery(
              getWorkflowListQueryOptions(targetWorkspaceId)
            )
          } catch {
            // Existence is unknowable right now; keep the tabs rather than delete
            // resources on a network failure. The next hydration retries.
            return
          }
          const missing = selectDeletedWorkflowResources(
            scopedResources,
            new Set(existing.map((workflow) => workflow.id)),
            getWorkflows(targetWorkspaceId)
          )
          for (const resource of missing) {
            if ((chatIdRef.current ?? selectedChatIdRef.current) !== chatId) return
            /** Personal delegation can read another workspace; absence from this list is not deletion. */
            try {
              await getQueryClient().fetchQuery({
                queryKey: workflowKeys.state(resource.id),
                queryFn: ({ signal }) => fetchWorkflowEnvelope(resource.id, signal),
                staleTime: 0,
              })
            } catch (error) {
              if (
                isApiClientError(error) &&
                error.status === 404 &&
                (chatIdRef.current ?? selectedChatIdRef.current) === chatId
              )
                removeResource(resource)
            }
          }
        })
      )
    },
    [workspaceId, organizationId, scopeKey, removeResource]
  )

  const reorderResources = useCallback(
    (newOrder: MothershipResource[]) => {
      setResources(newOrder)
      const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
      if (!persistChatId) return
      const persistableResources = [
        ...newOrder.filter((resource) => !isEphemeralResource(resource)),
        ...undisplayableResourcesRef.current,
      ]
      pendingResourceReorders.set(persistChatId, persistableResources)
      void flushPendingResourceReorder(persistChatId)
    },
    [flushPendingResourceReorder]
  )

  const ensureWorkflowToolResource = useCallback(
    (toolArgs: Record<string, unknown>): string | undefined => {
      const targetWorkspaceId =
        typeof toolArgs.workspaceId === 'string' ? toolArgs.workspaceId : workspaceId
      if (!targetWorkspaceId) return undefined
      const targetWorkflowId =
        typeof toolArgs.workflowId === 'string'
          ? toolArgs.workflowId
          : workspaceId
            ? useWorkflowRegistry.getState().activeWorkflowId
            : undefined

      if (!targetWorkflowId) {
        return undefined
      }

      const meta = getWorkflowById(targetWorkspaceId, targetWorkflowId)
      addResource({
        type: 'workflow',
        ...(organizationId ? { workspaceId: targetWorkspaceId } : {}),
        id: targetWorkflowId,
        title: meta?.name ?? 'Workflow',
      })
      onResourceEventRef.current?.(targetWorkflowId)

      return targetWorkflowId
    },
    [addResource, workspaceId, organizationId, scopeKey]
  )

  const startClientWorkflowTool = useCallback(
    (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>) => {
      if (!isWorkflowToolName(toolName)) {
        return
      }
      if (handledClientWorkflowToolIds.has(toolCallId)) {
        return
      }
      if (recoveringClientWorkflowToolIds.has(toolCallId)) {
        return
      }
      handledClientWorkflowToolIds.add(toolCallId)

      ensureWorkflowToolResource(toolArgs)
      executeRunToolOnClient(toolCallId, toolName, toolArgs)
    },
    [ensureWorkflowToolResource]
  )

  const startClientLocalFilesystemTool = useCallback(
    (
      toolCallId: string,
      toolName: string,
      toolArgs: Record<string, unknown>,
      desktopTurn: DesktopToolTurn | undefined
    ) => {
      if (
        !isNativeFileTool(toolName) &&
        (!workspaceId || !isUserLocalVfsToolCall(toolName, toolArgs))
      ) {
        return
      }
      if (handledClientLocalFilesystemToolIds.has(toolCallId)) {
        return
      }
      handledClientLocalFilesystemToolIds.add(toolCallId)
      const lease = desktopTurn?.lease()
      const options = {
        workspaceId,
        chatId: chatIdRef.current ?? selectedChatIdRef.current,
        signal: lease?.signal,
      }
      /**
       * Dynamic on purpose: the local-filesystem executor only runs for desktop-local
       * VFS tool calls, and a static import kept it in the shared chat chunk on every
       * surface that mounts the composer. The guard, the dedupe add, and the option
       * capture above stay synchronous, so re-entrancy behaviour is unchanged. If the
       * chunk fails to load (deploy skew), the server-side tool call must still settle:
       * report an error completion rather than leaving it hanging with the dedupe ref
       * already marked handled.
       */
      import('@/lib/mothership/tools/client/local-filesystem')
        .then(
          (m) => m.executeLocalFilesystemTool(toolCallId, toolName, toolArgs, options),
          async (error) => {
            logger.error('Failed to load local filesystem tool executor', { error })
            /**
             * The recovery itself can reject (the helper chunks or the completion POST can
             * fail for the same reason the executor chunk did). Contain it: an unhandled
             * rejection here would settle nothing and surface as a console error, exactly
             * like the executor's own report-failure path, which also degrades to a log.
             */
            try {
              const [{ reportClientToolCompletion }, { ASYNC_TOOL_CONFIRMATION_STATUS }] =
                await Promise.all([
                  import('@/lib/mothership/tools/client/completion'),
                  import('@/lib/mothership/async-runs/lifecycle'),
                ])
              await reportClientToolCompletion(
                toolCallId,
                ASYNC_TOOL_CONFIRMATION_STATUS.error,
                'Local filesystem tool failed to load'
              )
            } catch (reportError) {
              logger.error('Failed to report local filesystem tool load failure', {
                toolCallId,
                error: reportError,
              })
            }
          }
        )
        .catch((error) => {
          logger.error('Local filesystem tool execution failed unexpectedly', { toolCallId, error })
        })
        .finally(() => lease?.release())
    },
    [workspaceId, organizationId, scopeKey]
  )

  const getResourceActivityTracker = useCallback(
    (generation: number, targetChatId?: string) => {
      let tracker = resourceActivityTrackerRef.current
      if (!tracker || tracker.generation !== generation) {
        const isCurrentGeneration = generation === streamGenRef.current
        tracker = createResourceActivityTracker(
          generation,
          [activeTurnRef.current?.desktopScopeId ?? desktopScopeIdRef.current],
          {
            captureExisting: isCurrentGeneration,
          }
        )
        if (isCurrentGeneration) {
          resourceActivityTrackerRef.current = tracker
        }
      }
      if (targetChatId) {
        const targetScopeId = desktopChatScopeId(scopeKey, targetChatId)
        if (
          tracker.generation === streamGenRef.current &&
          resourceActivityTrackerRef.current === tracker
        ) {
          captureResourceActivityScope(tracker, targetScopeId)
        } else {
          tracker.scopeIds.add(targetScopeId)
          tracker.currentScopeId = targetScopeId
        }
      }
      return tracker
    },
    [workspaceId, organizationId, scopeKey]
  )

  const clearResourceActivity = useCallback(
    (tracker: ResourceActivityTracker, captureCurrentScope: boolean) => {
      const isCurrentBoundary =
        captureCurrentScope &&
        tracker.generation === streamGenRef.current &&
        resourceActivityTrackerRef.current === tracker
      if (isCurrentBoundary) {
        captureResourceActivityScope(tracker, desktopScopeIdRef.current)
        if (chatIdRef.current) {
          captureResourceActivityScope(tracker, desktopChatScopeId(scopeKey, chatIdRef.current))
        }
      }
      const currentTracker = resourceActivityTrackerRef.current
      if (!isCurrentBoundary && currentTracker && currentTracker !== tracker) {
        excludeActivityOwnedBy(tracker, currentTracker)
      }
      if (isCurrentBoundary) {
        // The native tool may outlive an SSE reader or its AbortController.
        // Fire cancellation without delaying the stream boundary below.
        void cancelActiveBrowserTools(new Set(tracker.scopeIds))
      }
      clearTrackedResourceActivity(tracker, { hardResetActivity: isCurrentBoundary })
      if (resourceActivityTrackerRef.current === tracker) {
        resourceActivityTrackerRef.current = null
      }
    },
    [workspaceId, organizationId, scopeKey]
  )

  const recoverPendingClientWorkflowTools = useCallback(
    async (nextMessages: ChatMessage[]) => {
      const pending: ToolCallInfo[] = []

      for (const message of nextMessages) {
        for (const block of message.contentBlocks ?? []) {
          const toolCall = block.toolCall
          if (!toolCall || !isWorkflowToolName(toolCall.name)) continue
          if (toolCall.status !== 'executing') continue
          if (
            handledClientWorkflowToolIds.has(toolCall.id) ||
            recoveringClientWorkflowToolIds.has(toolCall.id)
          ) {
            continue
          }
          recoveringClientWorkflowToolIds.add(toolCall.id)
          pending.push(toolCall)
        }
      }

      for (const toolCall of pending) {
        try {
          const toolArgs = toolCall.params ?? {}
          const targetWorkflowId = ensureWorkflowToolResource(toolArgs)

          if (targetWorkflowId) {
            const rebound = await bindRunToolToExecution(toolCall.id, targetWorkflowId)
            if (rebound) {
              handledClientWorkflowToolIds.add(toolCall.id)
              continue
            }
          }

          recoveringClientWorkflowToolIds.delete(toolCall.id)
          startClientWorkflowTool(toolCall.id, toolCall.name, toolArgs)
        } finally {
          recoveringClientWorkflowToolIds.delete(toolCall.id)
        }
      }
    },
    [ensureWorkflowToolResource, startClientWorkflowTool]
  )

  useEffect(() => {
    const previousDesktopScopeId = desktopScopeIdRef.current
    const canDiscardPreviousPendingScope = !sendingRef.current
    const streamOwnerId = chatIdRef.current
    const pendingTurn = activeTurnRef.current
    const pendingStreamId = streamIdRef.current ?? pendingTurn?.userMessageId
    const pendingResourceScopeId =
      streamOwnerId ?? pendingTurn?.pendingChatKey ?? pendingChatKeyRef.current
    const navigatedToDifferentChat =
      sendingRef.current &&
      initialChatId !== streamOwnerId &&
      (initialChatId !== undefined || streamOwnerId !== undefined)
    if (sendingRef.current) {
      if (navigatedToDifferentChat) {
        const abandonedChatId = streamOwnerId
        if (
          !abandonedChatId &&
          pendingStreamId &&
          isPendingDesktopScopeId(previousDesktopScopeId)
        ) {
          const pendingChatKey = pendingTurn?.pendingChatKey
          // The selected task changes before a brand-new stream necessarily
          // emits its chat id. Keep resolving that detached stream in the
          // background so its native resources are re-keyed onto the server
          // chat even though this reader is intentionally being cancelled.
          const detachedResolutionController = new AbortController()
          detachedChatResolutionControllers.add(detachedResolutionController)
          void (async () => {
            const resolution = await waitForDetachedChatResolution(
              () =>
                resolveDetachedChatForStreamRef.current(
                  pendingStreamId,
                  detachedResolutionController.signal
                ),
              detachedResolutionController.signal
            )
            const resolvedChatId = resolution.chatId
            if (!resolvedChatId) {
              await discardDesktopChatScopes(previousDesktopScopeId)
              logger.warn(
                'Detached stream ended without a chat id; discarded provisional resources',
                {
                  streamId: pendingStreamId,
                }
              )
              return
            }

            useChatPanelStore.getState().migrate(previousDesktopScopeId, resolvedChatId)
            await migrateDesktopChatScopes(previousDesktopScopeId, resolvedChatId)
            if (pendingChatKey) migrateOutgoing(pendingChatKey, resolvedChatId)
            await resourcePersistenceQueue.flush(resolvedChatId, pendingResourceScopeId)
            queryClient.invalidateQueries({
              queryKey: mothershipChatKeys.detail(resolvedChatId),
            })
            queryClient.invalidateQueries<readonly unknown[]>({
              queryKey: organizationId
                ? mothershipChatKeys.organizationList(organizationId)
                : mothershipChatKeys.list(workspaceId),
            })
          })()
            .catch((error) => {
              if (detachedResolutionController.signal.aborted) return
              logger.warn('Failed to attach provisional desktop resources to detached chat', {
                streamId: pendingStreamId,
                error: toError(error).message,
              })
            })
            .finally(() => {
              detachedChatResolutionControllers.delete(detachedResolutionController)
            })
        }
        // Detach the current UI from the old stream without cancelling it on the server.
        // Reopening that chat later will reconnect through the existing chatHistory flow.
        cancelActiveStreamRecovery()
        streamGenRef.current++
        cancelActiveStreamReader()
        abortControllerRef.current = null
        clearActiveTurn()
        setTransportIdle()
        if (abandonedChatId) {
          queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(abandonedChatId) })
        }
      } else {
        setResolvedChatId(initialChatId)
        return
      }
    }
    cancelActiveStreamRecovery()
    cancelActiveStreamReader()
    chatIdRef.current = initialChatId
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    updateCompletedTurn(null)
    clearActiveTurn()
    setResolvedChatId(initialChatId)
    appliedChatHistoryKeyRef.current = undefined
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    /** A controlled selection belongs to the destination URL, including on first mount. */
    if (!options?.activeResourceState && initialChatId !== streamOwnerId) {
      setActiveResourceId(null)
    }
    useTableViewPinStore.getState().reset()
    resetEphemeralPreviewState()
    // Rotate the bucket key; messages still on their way into the previous chat keep its key.
    if (initialChatId) {
      if (chatKeyRef.current !== initialChatId) {
        chatKeyRef.current = initialChatId
        setChatKey(initialChatId)
      }
    } else {
      pendingChatKeyRef.current = `${PENDING_CHAT_KEY_PREFIX}${generateShortId()}`
      chatKeyRef.current = pendingChatKeyRef.current
      setChatKey(pendingChatKeyRef.current)
    }
    const nextDesktopScopeId = desktopChatScopeId(
      scopeKey,
      initialChatId,
      pendingChatKeyRef.current
    )
    if (!initialChatId) pendingDesktopScopeIdRef.current = nextDesktopScopeId
    desktopScopeIdRef.current = nextDesktopScopeId
    setDesktopScopeId(nextDesktopScopeId)
    transitionDesktopScopes(
      previousDesktopScopeId,
      nextDesktopScopeId,
      canDiscardPreviousPendingScope
    )
  }, [
    initialChatId,
    queryClient,
    resetEphemeralPreviewState,
    clearActiveTurn,
    migrateOutgoing,
    updateCompletedTurn,
    setTransportIdle,
    cancelActiveStreamRecovery,
    cancelActiveStreamReader,
    workspaceId,
    organizationId,
    scopeKey,
  ])

  useEffect(() => {
    if (requestModeRef.current === 'assistant') return
    initBrowserAgentTransport()
    initTerminalTransport()
    void activateDesktopChatScopes(desktopScopeIdRef.current).catch(() => {})
  }, [organizationId, chatHistory?.mode, options?.requestMode])

  useEffect(() => {
    if (workflowIdRef.current) return
    if (!isHomePage || !chatIdRef.current) return
    resetHomeChatState()
  }, [isHomePage, resetHomeChatState])

  /**
   * A history read can lag a completed stream, including returning an older
   * transcript with a newly cleared stream marker. Retain the completed output
   * until its durable assistant is present. The first pass joins finalize's read;
   * later passes poll stream status before re-reading the transcript. The bounded
   * wait ends when this surface sends again, changes chats, or unmounts.
   */
  const awaitPersistedTurn = useCallback(
    async (chatId: string, streamId: string, expectsAssistant: boolean) => {
      if (persistedTurnWaitRef.current?.streamId === streamId) return
      persistedTurnWaitRef.current?.controller.abort('superseded:persisted_turn_wait')
      const wait = { streamId, controller: new AbortController() }
      persistedTurnWaitRef.current = wait
      const deadline = Date.now() + PERSISTED_TURN_WAIT_MS
      const isStillWaiting = () =>
        !wait.controller.signal.aborted &&
        surfaceMountedRef.current &&
        locallyTerminalStreamIdRef.current === streamId &&
        chatIdRef.current === chatId
      try {
        for (let attempt = 0; Date.now() < deadline; attempt++) {
          if (attempt > 0) {
            await sleep(
              backoffWithJitter(attempt, null, {
                baseMs: PERSISTED_TURN_REFETCH_BASE_MS,
                maxMs: PERSISTED_TURN_REFETCH_MAX_DELAY_MS,
              })
            )
            if (!isStillWaiting()) return
            const activeStreamId = await fetchMothershipChatActiveStreamId(
              chatId,
              wait.controller.signal
            ).catch(() => undefined)
            if (activeStreamId === streamId) continue
          }
          if (!isStillWaiting()) return
          await queryClient.refetchQueries(
            { queryKey: mothershipChatKeys.detail(chatId), exact: true },
            { cancelRefetch: false }
          )
          const history = queryClient.getQueryData<MothershipChatHistory>(
            mothershipChatKeys.detail(chatId)
          )
          if (
            history &&
            (hasTerminalPersistedAssistantForStream(
              history.messages,
              streamId,
              getLiveAssistantMessageId(streamId)
            ) ||
              (!expectsAssistant && history.activeStreamId !== streamId))
          ) {
            if (completedTurnRef.current?.userMessage.id === streamId) {
              updateCompletedTurn(null)
            }
            return
          }
        }
      } finally {
        if (persistedTurnWaitRef.current === wait) persistedTurnWaitRef.current = null
      }
    },
    [queryClient, updateCompletedTurn]
  )

  useEffect(() => {
    if (!chatHistory) return

    const hydrationKey = buildChatHistoryHydrationKey(chatHistory)
    if (appliedChatHistoryKeyRef.current === hydrationKey) return

    const activeStreamId = chatHistory.activeStreamId
    appliedChatHistoryKeyRef.current = hydrationKey
    const mappedMessages = chatHistory.messages.map(toDisplayMessage)
    const shouldReconnectActiveStream =
      Boolean(activeStreamId) &&
      !sendingRef.current &&
      activeStreamId !== locallyTerminalStreamIdRef.current &&
      !isTerminalStreamStatus(chatHistory.streamSnapshot?.status)

    if (
      !sendingRef.current &&
      (!activeStreamId || isTerminalStreamStatus(chatHistory.streamSnapshot?.status))
    ) {
      const hydratedScopeId = desktopChatScopeId(scopeKey, chatHistory.id)
      clearResourceActivityScope(hydratedScopeId)
      void cancelActiveBrowserTools([hydratedScopeId])
    }

    const terminalStreamId = locallyTerminalStreamIdRef.current
    const completed = completedTurnRef.current
    const terminalAssistantPersisted =
      terminalStreamId &&
      hasTerminalPersistedAssistantForStream(
        chatHistory.messages,
        terminalStreamId,
        getLiveAssistantMessageId(terminalStreamId)
      )
    if (
      terminalStreamId &&
      (terminalAssistantPersisted ||
        (!activeStreamId && completed?.userMessage.id !== terminalStreamId))
    ) {
      locallyTerminalStreamIdRef.current = undefined
      if (completed?.userMessage.id === terminalStreamId) updateCompletedTurn(null)
    }

    void recoverPendingClientWorkflowTools(mappedMessages)

    const hasPersistedStreamingFile = chatHistory.resources.some((r) => r.id === 'streaming-file')
    if (hasPersistedStreamingFile) {
      requestJson(removeMothershipChatResourceContract, {
        body: {
          chatId: chatHistory.id,
          resourceType: 'file',
          resourceId: 'streaming-file',
        },
      }).catch(() => {})
    }

    flushPendingResources(chatHistory.id)

    // Browser and terminal rows stored by older clients are dropped: the
    // desktop app's live tab lists are what put those tabs in the strip now.
    const persistedResources = sanitizeChatResources(
      chatHistory.resources.filter((r) => r.id !== 'streaming-file')
    )
    const keyOf = chatResourceKeyFor(workspaceId)
    let updatedResources = resourcePersistenceQueue.applyPendingUpdates(
      chatHistory.id,
      persistedResources
    )
    /** Recovery discards interim search tabs without taking an already visible panel away. */
    if (
      requestModeRef.current === 'assistant' &&
      !sendingRef.current &&
      (!activeStreamId || isTerminalStreamStatus(chatHistory.streamSnapshot?.status))
    ) {
      for (const resource of updatedResources) {
        if (
          resource.type === 'search' &&
          getChatResourceSelectionId(resource) !== selectedResourceIdRef.current &&
          !resourcesRef.current.some((visible) => keyOf(visible) === keyOf(resource))
        ) {
          removeResource(resource)
        }
      }
      updatedResources = resourcePersistenceQueue.applyPendingUpdates(
        chatHistory.id,
        persistedResources
      )
    }
    // A stored panel this client cannot open is kept out of the tab strip
    // rather than restored onto an error, but stays in the stored set so the
    // desktop app still gets it back.
    const pendingOrder = pendingResourceReorders.get(chatHistory.id)
    const projectedResources = pendingOrder
      ? (reorderStoredChatResources(updatedResources, pendingOrder, workspaceId) ??
        updatedResources)
      : updatedResources
    const keepSearchPanelStable =
      requestModeRef.current === 'assistant' &&
      (sendingRef.current ||
        (activeStreamId && !isTerminalStreamStatus(chatHistory.streamSnapshot?.status)))
    const restorableResources = projectedResources
      .filter(canDisplayResource)
      .flatMap((resource) => {
        if (!keepSearchPanelStable || resource.type !== 'search') return [resource]
        const visible = resourcesRef.current.find((item) => keyOf(item) === keyOf(resource))
        if (visible) return [visible]
        return getChatResourceSelectionId(resource) === selectedResourceIdRef.current
          ? [resource]
          : []
      })
    undisplayableResourcesRef.current = persistedResources.filter((r) => !canDisplayResource(r))
    // Keyed on everything the server holds, not just what is restorable, so a
    // resource being hidden cannot make it look local-only and get re-added.
    const serverKeys = new Set(persistedResources.map((r) => keyOf(r)))
    const localOnly = resourcesRef.current.filter(
      (r) =>
        r.id !== 'streaming-file' &&
        !serverKeys.has(keyOf(r)) &&
        (isEphemeralResource(r) || resourcePersistenceQueue.hasPendingUpsert(chatHistory.id, r))
    )
    // Server order is authoritative for persisted resources, but local-only
    // items (pending-persist adds and synthetic ephemeral panels)
    // keep their current on-screen position — hydration reruns on every send
    // and stream completion, and appending them at the end made those tabs
    // visibly jump/flash each time.
    const localOnlyKeys = new Set(localOnly.map((r) => keyOf(r)))
    const mergedResources = restorableResources.filter((r) => !localOnlyKeys.has(keyOf(r)))
    for (const resource of localOnly) {
      const currentIndex = resourcesRef.current.findIndex((r) => keyOf(r) === keyOf(resource))
      const insertAt =
        currentIndex < 0 ? mergedResources.length : Math.min(currentIndex, mergedResources.length)
      mergedResources.splice(insertAt, 0, resource)
    }
    const resourcesUnchanged =
      JSON.stringify(mergedResources) === JSON.stringify(resourcesRef.current)

    if (mergedResources.length > 0) {
      // An explicit selection wins. Otherwise pin the last resource the server
      // holds, not the last on screen: local-only browser tabs can land before
      // the history does, and which side arrives first must not decide which
      // tab the chat opens on. When the server holds nothing it writes no
      // fallback at all: the selection stays empty so the shown resource can be
      // resolved against the tab the desktop app remembers.
      const selectedResourceId = selectedResourceIdRef.current
      const hydratedActiveResourceId =
        selectedResourceId &&
        mergedResources.some(
          (resource) => getChatResourceSelectionId(resource) === selectedResourceId
        )
          ? selectedResourceId
          : restorableResources.length
            ? getChatResourceSelectionId(restorableResources[restorableResources.length - 1])
            : null
      // Replacing the array with an identical one still re-renders the tab
      // strip and panel — skip the no-op so open panels don't flash.
      if (!resourcesUnchanged) {
        // The ref is set eagerly so a request sent in this commit still
        // attaches a resource, through the same rule the render path uses.
        activeResourceIdRef.current = resolveEffectiveResourceId(
          mergedResources,
          hydratedActiveResourceId,
          nativeActiveTabIdsRef.current
        )
        setResources(mergedResources)
        setActiveResourceId(hydratedActiveResourceId)
      }

      // Restored workflow tabs are verified against the server instead of
      // seeded into the registry: a chat can outlive its workflows, and
      // fabricating entries for deleted ones polluted the sidebar.
      const workflowResources = persistedResources.filter((r) => r.type === 'workflow')
      if (workflowResources.length > 0) {
        void reconcileHydratedWorkflowResources(chatHistory.id, workflowResources)
      }
    } else if (resourcesRef.current.length > 0 || hasPersistedStreamingFile) {
      activeResourceIdRef.current = null
      setResources([])
      setActiveResourceId(null)
    }

    const snapshotPreviewSessions = Array.isArray(chatHistory.streamSnapshot?.previewSessions)
      ? (chatHistory.streamSnapshot.previewSessions as FilePreviewSession[])
      : []
    if (snapshotPreviewSessions.length > 0) {
      seedPreviewSessions(snapshotPreviewSessions)
    }

    if (shouldReconnectActiveStream && activeStreamId) {
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      cancelActiveStreamRecovery()
      const replacedController = abortControllerRef.current
      if (replacedController && !replacedController.signal.aborted) {
        replacedController.abort('superseded_chat_history_reconnect')
      }
      cancelActiveStreamReader()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      setTransportReconnecting()

      // Load-time reconnects always rebuild the live turn from the Redis
      // replay buffer (seq 0): the buffer is the source of truth for an
      // in-flight turn, and any local state here is detached from the stream
      // loop that produced it. The DB transcript only supplies prior turns.
      // If the buffer is empty on a terminal run, the resume flow finalizes
      // and refetches the persisted transcript from the DB instead.
      const assistantId = getLiveAssistantMessageId(activeStreamId)
      streamingContentRef.current = ''
      streamingBlocksRef.current = []
      lastCursorRef.current = '0'

      const reconnect = async () => {
        const succeeded = await retryReconnectRef.current({
          streamId: activeStreamId,
          assistantId,
          gen,
          targetChatId: chatHistory.id,
        })
        if (succeeded && streamGenRef.current === gen && sendingRef.current) {
          finalizeRef.current({ targetChatId: chatHistory.id })
          return
        }
        if (succeeded && streamGenRef.current === gen) {
          setTransportIdle()
          abortControllerRef.current = null
          return
        }
        if (!succeeded && streamGenRef.current === gen) {
          try {
            finalizeRef.current({
              error: true,
              targetChatId: chatHistory.id,
              streamTerminal: false,
            })
          } catch {
            setTransportIdle()
            abortControllerRef.current = null
            setError('Failed to reconnect to the active stream')
          }
        }
      }
      reconnect()
    }
  }, [
    chatHistory,
    workspaceId,
    cancelActiveStreamReader,
    cancelActiveStreamRecovery,
    flushPendingResources,
    reconcileHydratedWorkflowResources,
    removeResource,
    recoverPendingClientWorkflowTools,
    seedPreviewSessions,
    setTransportIdle,
    setTransportReconnecting,
    updateCompletedTurn,
  ])

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: {
        preserveExistingState?: boolean
        resumeCursor?: string
        deferFlushes?: boolean
        suppressedWorkflowToolStartIds?: ReadonlySet<string>
        targetChatId?: string
        shouldContinue?: () => boolean
      }
    ) => {
      const desktopTurn = streamIdRef.current ? desktopTools.turn(streamIdRef.current) : undefined
      const activityTracker = getResourceActivityTracker(
        expectedGen ?? streamGenRef.current,
        options?.targetChatId
      )
      const activityScopeId = () => activityTracker.currentScopeId
      const startBrowserAgentRunForStream = (runId: string) => {
        const scopeId = activityScopeId()
        setTrackedBrowserRun(activityTracker, scopeId, runId, true)
      }
      const endBrowserAgentRunForStream = (runId: string) => {
        const scopeId = activityScopeId()
        setTrackedBrowserRun(activityTracker, scopeId, runId, false)
      }
      const startClientBrowserToolForStream = (
        toolCallId: string,
        toolName: string,
        toolArgs: Record<string, unknown>,
        eventTs?: string
      ) => {
        const scopeId = activityScopeId()
        startClientBrowserTool(toolCallId, toolName, toolArgs, scopeId, eventTs, desktopTurn)
      }
      const startClientTerminalToolForStream = (
        toolCallId: string,
        toolName: string,
        toolArgs: Record<string, unknown>,
        eventTs?: string
      ) => {
        const scopeId = activityScopeId()
        trackTerminalToolCall(activityTracker, scopeId, toolCallId)
        startClientTerminalTool(toolCallId, toolName, toolArgs, scopeId, eventTs)
      }
      const clearStreamResourceActivity = () => clearResourceActivity(activityTracker, true)
      const ctx = createStreamLoopContext({
        requestMode: requestModeRef.current,
        citedSourcesEnabled: requestModeRef.current === 'assistant',
        refreshRoute: () => router.refresh(),
        viewerId,
        workspaceId,
        organizationId,
        queryClient,
        assistantId,
        expectedGen,
        options: options ?? {},
        setError,
        setPendingMessages,
        setResolvedChatId,
        adoptResolvedChatId,
        setResources,
        setActiveResourceId,
        addResource,
        removeResource,
        discardPendingResourceUpsert,
        startClientWorkflowTool,
        startClientLocalFilesystemTool: (toolCallId, toolName, toolArgs) =>
          startClientLocalFilesystemTool(toolCallId, toolName, toolArgs, desktopTurn),
        startClientComputerTool: (toolCallId, args, eventTs) => {
          const lease = desktopTurn?.lease()
          void executeComputerToolOnClient(toolCallId, args, eventTs, lease?.signal).finally(() =>
            lease?.release()
          )
        },
        startClientBrowserTool: startClientBrowserToolForStream,
        startClientTerminalTool: startClientTerminalToolForStream,
        startBrowserAgentRun: startBrowserAgentRunForStream,
        endBrowserAgentRun: endBrowserAgentRunForStream,
        clearBrowserAgentRuns: clearStreamResourceActivity,
        upsertMothershipChatHistory: upsertChatHistory,
        ensureWorkflowInRegistry,
        onPreviewPhase,
        applyPreviewSessionUpdate,
        removePreviewSessionImmediate,
        promoteFileResource,
        shouldAutoActivatePreviewSession,
        buildAssistantSnapshotMessage,
        hasTerminalPersistedAssistantForStream,
        reconcileLiveAssistantTurn,
        streamGenRef,
        streamingBlocksRef,
        streamingContentRef,
        chatIdRef,
        selectedChatIdRef,
        streamIdRef,
        revealedSimKeys,
        pendingUserMsgRef,
        activeTurnRef,
        resourcesRef,
        activeResourceIdRef,
        onTitleUpdateRef,
        onToolResultRef,
        onResourceEventRef,
        previewSessionRef,
        previewSessionsRef,
        latestPreviewTargetToolCallIdRef,
        activePreviewSessionIdRef,
        completedPreviewResourceHandoffRef,
        previewActivationOwnerRef,
      })
      const { state, ops } = ctx
      if (ops.isStale()) {
        void reader.cancel().catch(() => {})
        return { sawStreamError: false, sawComplete: false }
      }
      streamReaderRef.current = reader

      try {
        await readSSELines(reader, {
          idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
          onData: (raw) => {
            if (state.sawCompleteEvent) return true
            if (ops.isStale()) return

            const parsedResult = parsePersistedStreamEventEnvelopeJson(raw)
            if (!parsedResult.ok) {
              const error = createStreamSchemaValidationError(parsedResult, 'Live SSE event.')
              logger.error('Rejected chat SSE event due to client-side schema enforcement', {
                reason: parsedResult.reason,
                message: parsedResult.message,
                errors: parsedResult.errors,
                error: error.message,
              })
              throw error
            }
            const parsed = parsedResult.event

            if (parsed.trace?.requestId && parsed.trace.requestId !== state.streamRequestId) {
              state.streamRequestId = parsed.trace.requestId
              streamRequestIdRef.current = state.streamRequestId
              ops.flush()
            }
            if (parsed.stream?.streamId) {
              streamIdRef.current = parsed.stream.streamId
            }
            const eventCursor = parsed.stream?.cursor ?? String(parsed.seq)
            if (isAlreadyProcessedStreamCursor(eventCursor, lastCursorRef.current)) {
              return
            }
            if (eventCursor) {
              lastCursorRef.current = eventCursor
            }

            logger.debug('SSE event received', parsed)
            dispatchStreamEvent(ctx, parsed)
            if (state.sawCompleteEvent) return true
          },
        })
      } finally {
        // A transport read failure may reconnect this same generation. Keep
        // its exact resource activity alive until a terminal stream event or
        // finalize/Stop establishes the real boundary.
        if (state.sawStreamError) {
          clearStreamResourceActivity()
          state.browserAgentRunIds.clear()
        }
        if (state.sawStreamError && !state.sawCompleteEvent) {
          applyTurnTerminal(state.model, 'error')
          ops.flush()
        }
        if (state.scheduledTextFlushFrame !== null) {
          cancelAnimationFrame(state.scheduledTextFlushFrame)
          state.scheduledTextFlushFrame = null
          ops.flush()
        }
        if (state.scheduledTextFlushTimer !== null) {
          clearTimeout(state.scheduledTextFlushTimer)
          state.scheduledTextFlushTimer = null
          ops.flush()
        }
        // Batch-replay mode publishes exactly one snapshot, here at the end,
        // so the rendered message goes stale-prefix -> full in a single step
        // instead of collapsing and re-revealing through partial flushes.
        if (options?.deferFlushes) {
          ops.forceFlush()
        }
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null
        }
      }
      // The server's verdict priority (its backendFinishedTurn rule): a terminal
      // complete{status:complete} outranks any non-fatal mid-stream error frame —
      // subagent hiccups the orchestrator recovered from are inline content, not the
      // turn's outcome. Conversely complete{status:error} is an error even when no
      // error frame preceded it. Deciding here means every consumer (send path,
      // reconnect replay, live tail) inherits the same rule.
      const terminalStatus = state.completionStatus
      const settledError =
        terminalStatus === 'complete' ? false : state.sawStreamError || terminalStatus === 'error'
      return {
        sawStreamError: settledError && !state.inputApplied,
        sawComplete: state.sawCompleteEvent,
        inputApplied: state.inputApplied,
      }
    },
    [
      router,
      viewerId,
      workspaceId,
      queryClient,
      addResource,
      removeResource,
      discardPendingResourceUpsert,
      startClientWorkflowTool,
      startClientLocalFilesystemTool,
      startClientTerminalTool,
      getResourceActivityTracker,
      clearResourceActivity,
      adoptResolvedChatId,
      upsertChatHistory,
      onPreviewPhase,
      applyPreviewSessionUpdate,
      removePreviewSessionImmediate,
      promoteFileResource,
      shouldAutoActivatePreviewSession,
    ]
  )
  processSSEStreamRef.current = processSSEStream

  const getActiveStreamIdForChat = useCallback(
    async (
      chatId: string,
      signal?: AbortSignal
    ): Promise<{ loaded: boolean; streamId: string | null }> => {
      const cached = queryClient.getQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId)
      )

      try {
        const fetchSignal = combineAbortSignals(
          signal,
          createTimeoutSignal(CHAT_HISTORY_RECOVERY_TIMEOUT_MS)
        )
        const history = await fetchMothershipChatHistory(chatId, fetchSignal, () =>
          queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
        )
        if (signal?.aborted || fetchSignal?.aborted) return { loaded: false, streamId: null }
        queryClient.setQueryData(mothershipChatKeys.detail(chatId), history)
        return { loaded: true, streamId: history.activeStreamId ?? null }
      } catch (error) {
        logger.warn('Failed to load chat history while recovering stream', {
          chatId,
          error: toError(error).message,
        })
        return { loaded: false, streamId: cached?.activeStreamId ?? null }
      }
    },
    [queryClient]
  )

  const fetchStreamBatch = useCallback(
    async (
      streamId: string,
      afterCursor: string,
      signal?: AbortSignal
    ): Promise<StreamBatchResponse> => {
      const fetchSignal = combineAbortSignals(
        signal,
        createTimeoutSignal(STREAM_BATCH_FETCH_TIMEOUT_MS)
      )
      // boundary-raw-fetch: stream-resume batch endpoint requires dynamic per-request traceparent header propagation that the contract layer does not model, and the response is consumed alongside live SSE tail fetches
      const response = await fetch(
        `/api/mothership/chat/stream?${streamReconnectQuery(streamId, afterCursor, logResyncedStreamIdRef.current === streamId)}&batch=true`,
        {
          signal: fetchSignal,
          ...(streamTraceparentRef.current
            ? { headers: { traceparent: streamTraceparentRef.current } }
            : {}),
        }
      )
      if (response.status === 404) {
        throw new StreamGoneError(streamId)
      }
      if (!response.ok) {
        throw new Error(`Stream resume batch failed: ${response.status}`)
      }
      return parseStreamBatchResponse(await response.json())
    },
    []
  )

  const resolveChatIdForStream = useCallback(
    async (
      streamId: string,
      options?: { preferExistingChatId?: boolean; signal?: AbortSignal }
    ): Promise<string | undefined> => {
      if (options?.preferExistingChatId !== false) {
        const existingChatId = chatIdRef.current ?? selectedChatIdRef.current
        if (existingChatId) return existingChatId
      }

      const deadline = Date.now() + STREAM_CHAT_ID_RESOLVE_TIMEOUT_MS
      let retryDelayMs = 250
      let lastError: unknown

      while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw createAbortError(options.signal)
        const remainingMs = Math.max(1, deadline - Date.now())
        try {
          const batch = await fetchStreamBatch(
            streamId,
            '0',
            combineAbortSignals(
              options?.signal,
              createTimeoutSignal(Math.min(remainingMs, STREAM_BATCH_FETCH_TIMEOUT_MS))
            )
          )
          const chatId = resolveChatIdFromStreamBatch(batch)
          if (chatId) return chatId
        } catch (error) {
          lastError = error
          if (error instanceof Error && error.name === 'AbortError' && Date.now() >= deadline) {
            break
          }
        }

        await sleepWithAbort(
          Math.min(retryDelayMs, Math.max(1, deadline - Date.now())),
          options?.signal
        )
        retryDelayMs = Math.min(retryDelayMs * 2, 2000)
      }

      if (lastError) {
        logger.warn('Failed to resolve chat id for stream before timeout', {
          streamId,
          error: toError(lastError).message,
        })
      }
      return undefined
    },
    [fetchStreamBatch]
  )
  const resolveDetachedChatForStream = useCallback(
    async (streamId: string, signal?: AbortSignal): Promise<DetachedChatResolution> => {
      try {
        const batch = await fetchStreamBatch(streamId, '0', signal)
        const chatId = resolveChatIdFromStreamBatch(batch)
        return {
          ...(chatId ? { chatId } : {}),
          terminal: !chatId && isTerminalStreamStatus(batch.status),
        }
      } catch (error) {
        // A gone stream cannot yield a durable owner later. Network and
        // timeout failures remain retryable, so detached native resources
        // survive long offline windows instead of being orphaned after a
        // fixed number of attempts.
        return { terminal: isStreamGoneError(error) }
      }
    },
    [fetchStreamBatch]
  )
  resolveDetachedChatForStreamRef.current = resolveDetachedChatForStream

  const seedStreamBatchPreviewSessions = useCallback(
    (batch: StreamBatchResponse) => {
      if (Array.isArray(batch.previewSessions) && batch.previewSessions.length > 0) {
        seedPreviewSessions(batch.previewSessions)
      }
    },
    [seedPreviewSessions]
  )

  const attachToExistingStream = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      expectedGen: number
      initialBatch?: StreamBatchResponse | null
      afterCursor?: string
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<{ error: boolean; aborted: boolean }> => {
      const {
        streamId,
        assistantId,
        expectedGen,
        afterCursor = '0',
        targetChatId,
        shouldContinue,
      } = opts

      const isStaleReconnect = () =>
        streamGenRef.current !== expectedGen ||
        abortControllerRef.current?.signal.aborted === true ||
        shouldContinue?.() === false

      if (isStaleReconnect()) {
        return { error: false, aborted: true }
      }

      // `afterCursor` must be the cursor the current streaming refs correspond
      // to (or '0' with a fresh rebuild) — the seed replay re-baselines the
      // rebuilt model's seq high-water mark to it, so a cursor ahead of the
      // refs silently drops the seed events as replays.
      const initialReplaySelection: Pick<
        ReconnectReplaySelection,
        'afterCursor' | 'preserveExistingState'
      > = applyReconnectReplaySelection(streamId, afterCursor)
      let latestCursor = initialReplaySelection.afterCursor
      let preserveNextReplayState = initialReplaySelection.preserveExistingState
      let seedEvents = opts.initialBatch?.events ?? []
      let streamStatus = opts.initialBatch?.status ?? 'unknown'
      let suppressedSeedWorkflowToolStartIds = getReplayCompletedWorkflowToolCallIds(seedEvents)

      setTransportReconnecting()
      setError(null)

      try {
        while (streamGenRef.current === expectedGen) {
          if (seedEvents.length > 0) {
            const replayResult = await processSSEStreamRef.current(
              buildReplayStream(seedEvents).getReader(),
              assistantId,
              expectedGen,
              {
                preserveExistingState: preserveNextReplayState,
                resumeCursor: latestCursor,
                deferFlushes: true,
                suppressedWorkflowToolStartIds: suppressedSeedWorkflowToolStartIds,
                ...(opts.initialBatch?.desktopToolsOnDevice ? { desktopToolsOnDevice: true } : {}),
                ...(targetChatId ? { targetChatId } : {}),
                ...(shouldContinue ? { shouldContinue } : {}),
              }
            )
            if (isStaleReconnect()) {
              return { error: false, aborted: true }
            }
            latestCursor = String(seedEvents[seedEvents.length - 1]?.eventId ?? latestCursor)
            lastCursorRef.current = latestCursor
            seedEvents = []
            preserveNextReplayState = true
            suppressedSeedWorkflowToolStartIds = new Set()

            if (replayResult.sawStreamError) {
              return { error: true, aborted: false }
            }
          }

          if (isTerminalStreamStatus(streamStatus)) {
            if (streamStatus === 'error') {
              setError(RECONNECT_TAIL_ERROR)
            }
            return { error: streamStatus === 'error', aborted: false }
          }

          const activeAbort = abortControllerRef.current
          if (!activeAbort || activeAbort.signal.aborted) {
            return { error: false, aborted: true }
          }

          logger.info('Opening live stream tail', { streamId, afterCursor: latestCursor })

          // boundary-raw-fetch: live SSE tail endpoint streams events consumed via response.body.getReader() and processSSEStream
          const sseRes = await fetch(
            `/api/mothership/chat/stream?${streamReconnectQuery(streamId, latestCursor, logResyncedStreamIdRef.current === streamId)}`,
            {
              signal: activeAbort.signal,
              ...(streamTraceparentRef.current
                ? { headers: { traceparent: streamTraceparentRef.current } }
                : {}),
            }
          )
          if (sseRes.status === 404) {
            throw new StreamGoneError(streamId)
          }
          if (!sseRes.ok || !sseRes.body) {
            throw new Error(RECONNECT_TAIL_ERROR)
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          // Re-sent from the worker's log with cursors restarting at 1: rebuild from empty.
          if (sseRes.headers.get(MOTHERSHIP_STREAM_REPLAY_HEADER) === 'log') {
            logResyncedStreamIdRef.current = streamId
            const reset = applyReconnectReplaySelection(streamId, '0')
            latestCursor = reset.afterCursor
            preserveNextReplayState = reset.preserveExistingState
          }

          setTransportStreaming()

          const liveResult = await processSSEStreamRef.current(
            sseRes.body.getReader(),
            assistantId,
            expectedGen,
            {
              preserveExistingState: preserveNextReplayState,
              resumeCursor: latestCursor,
              ...(sseRes.headers.get(MOTHERSHIP_DESKTOP_EXECUTOR_HEADER) === 'device'
                ? { desktopToolsOnDevice: true }
                : {}),
              ...(targetChatId ? { targetChatId } : {}),
              ...(shouldContinue ? { shouldContinue } : {}),
            }
          )
          preserveNextReplayState = true

          if (liveResult.sawStreamError) {
            return { error: true, aborted: false }
          }

          if (liveResult.sawComplete) {
            return { error: false, aborted: false }
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          setTransportReconnecting()

          latestCursor = lastCursorRef.current || latestCursor

          logger.warn('Live stream ended without terminal event, fetching batch', {
            streamId,
            latestCursor,
          })

          const batch = await fetchStreamBatch(streamId, latestCursor, activeAbort.signal)
          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }
          seedStreamBatchPreviewSessions(batch)
          seedEvents = batch.events
          streamStatus = batch.status
          suppressedSeedWorkflowToolStartIds = getReplayCompletedWorkflowToolCallIds(seedEvents)

          // `latestCursor` stays at the pre-batch position so the seed replay
          // at the top of the loop folds the batch events into the model; the
          // replay advances the cursor after applying them.

          if (batch.events.length === 0 && !isTerminalStreamStatus(batch.status)) {
            if (activeAbort.signal.aborted || streamGenRef.current !== expectedGen) {
              return { error: false, aborted: true }
            }
            /* A middlebox that closes the SSE tail promptly makes this loop spin
               tail->batch->tail with zero delay. An empty non-terminal batch means
               nothing new arrived — pace the next cycle instead of hammering. */
            await sleep(1_000)
          }
        }

        return { error: false, aborted: true }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { error: false, aborted: true }
        }
        throw err
      } finally {
        if (streamGenRef.current === expectedGen) {
          if (sendingRef.current) {
            setIsReconnecting(false)
          } else {
            setTransportIdle()
          }
        }
      }
    },
    [
      applyReconnectReplaySelection,
      fetchStreamBatch,
      seedStreamBatchPreviewSessions,
      setTransportIdle,
      setTransportReconnecting,
      setTransportStreaming,
    ]
  )

  const resumeOrFinalize = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      afterCursor: string
      signal?: AbortSignal
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<void> => {
      const { streamId, assistantId, gen, afterCursor, signal, targetChatId, shouldContinue } = opts

      if (streamGenRef.current !== gen || signal?.aborted || shouldContinue?.() === false) return

      const replaySelection = applyReconnectReplaySelection(streamId, afterCursor)
      const batch = await fetchStreamBatch(streamId, replaySelection.afterCursor, signal)
      if (streamGenRef.current !== gen || shouldContinue?.() === false) return
      seedStreamBatchPreviewSessions(batch)

      if (isTerminalStreamStatus(batch.status)) {
        if (batch.events.length > 0) {
          await processSSEStreamRef.current(
            buildReplayStream(batch.events).getReader(),
            assistantId,
            gen,
            {
              preserveExistingState: replaySelection.preserveExistingState,
              resumeCursor: replaySelection.afterCursor,
              deferFlushes: true,
              suppressedWorkflowToolStartIds: getReplayCompletedWorkflowToolCallIds(batch.events),
              ...(batch.desktopToolsOnDevice ? { desktopToolsOnDevice: true } : {}),
              ...(targetChatId ? { targetChatId } : {}),
              ...(shouldContinue ? { shouldContinue } : {}),
            }
          )
        }
        if (streamGenRef.current !== gen || shouldContinue?.() === false) return
        finalizeRef.current({
          ...(batch.status === 'error' ? { error: true } : {}),
          ...(targetChatId ? { targetChatId } : {}),
        })
        return
      }

      // Pass the cursor the streaming refs correspond to — NOT the batch's
      // last event id. The seed replay re-baselines the rebuilt model to this
      // cursor before folding the batch in; a cursor already advanced past
      // the batch made the replay drop every event as a duplicate, which
      // rendered an empty message (and suffix-only text once the tail
      // appended to it).
      const reconnectResult = await attachToExistingStream({
        streamId,
        assistantId,
        expectedGen: gen,
        initialBatch: batch,
        ...(targetChatId ? { targetChatId } : {}),
        ...(shouldContinue ? { shouldContinue } : {}),
        afterCursor: replaySelection.afterCursor,
      })

      if (
        streamGenRef.current === gen &&
        !reconnectResult.aborted &&
        shouldContinue?.() !== false
      ) {
        finalizeRef.current({
          ...(reconnectResult.error ? { error: true } : {}),
          ...(targetChatId ? { targetChatId } : {}),
        })
      } else if (
        streamGenRef.current === gen &&
        reconnectResult.aborted &&
        !sendingRef.current &&
        shouldContinue?.() !== false
      ) {
        setTransportIdle()
      }
    },
    [
      applyReconnectReplaySelection,
      fetchStreamBatch,
      seedStreamBatchPreviewSessions,
      attachToExistingStream,
      setTransportIdle,
    ]
  )

  const retryReconnect = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<boolean> => {
      const { streamId, assistantId, gen, targetChatId, shouldContinue } = opts

      const isStaleReconnect = () =>
        streamGenRef.current !== gen ||
        abortControllerRef.current?.signal.aborted === true ||
        shouldContinue?.() === false

      /**
       * An attempt whose tail delivered new events re-attached successfully, so
       * the failure after it starts a fresh budget at the base delay. Only
       * failures without progress count toward exhaustion, which keeps separate
       * network drops hours apart in a long turn from adding up.
       */
      let attempt = 0
      while (attempt <= MAX_RECONNECT_ATTEMPTS) {
        if (isStaleReconnect()) return true
        const cursorBeforeAttempt = lastCursorRef.current

        if (attempt > 0) {
          const delayMs = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
            RECONNECT_MAX_DELAY_MS
          )
          logger.warn('Reconnect attempt', {
            streamId,
            attempt,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            delayMs,
          })

          if (isStaleReconnect()) return true

          setTransportReconnecting()
          try {
            await sleepWithAbort(delayMs, abortControllerRef.current?.signal)
          } catch (err) {
            if (!(err instanceof Error) || err.name !== 'AbortError') {
              throw err
            }
          }
          if (isStaleReconnect()) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
        }

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortControllerRef.current?.signal,
            ...(targetChatId ? { targetChatId } : {}),
            ...(shouldContinue ? { shouldContinue } : {}),
          })
          if (streamGenRef.current !== gen) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (abortControllerRef.current?.signal.aborted) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (!sendingRef.current) {
            setTransportIdle()
            return true
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (isStreamGoneError(err)) {
            // Nothing left to resume (no run for the stream) — the persisted
            // DB transcript is authoritative now. Finalize so the detail
            // query refetches it instead of surfacing a reconnect error.
            logger.warn('Stream no longer exists; falling back to persisted transcript', {
              streamId,
            })
            if (streamGenRef.current === gen) {
              finalizeRef.current({ ...(targetChatId ? { targetChatId } : {}) })
            }
            return true
          }
          if (isStreamSchemaValidationError(err)) {
            logger.error('Reconnect halted by client-side stream schema enforcement', {
              streamId,
              attempt: attempt + 1,
              error: err.message,
            })
            if (streamGenRef.current === gen) {
              setError(err.message)
            }
            return false
          }
          logger.warn('Reconnect attempt failed', {
            streamId,
            attempt: attempt + 1,
            error: toError(err).message,
          })
        }
        attempt = lastCursorRef.current !== cursorBeforeAttempt ? 1 : attempt + 1
      }

      logger.error('All reconnect attempts exhausted', {
        streamId,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      if (streamGenRef.current === gen) {
        /**
         * Never give up silently: surface the failure so the pane shows why
         * the live stream stopped instead of a torn-down transcript. Callers
         * own the finalize on a false return (every call site finalizes with
         * error: true), which refetches the persisted transcript; if the
         * server turn is still running, the visibility/online recovery path
         * re-attaches on the next pageshow/visible/online event.
         */
        setIsReconnecting(false)
        setError(RECONNECT_TAIL_ERROR)
        /**
         * The tab may stay visible (no pageshow/visible/online event will ever
         * fire) while the server turn keeps running detached. One bounded
         * recheck re-enters recovery once the transient network condition has
         * had time to clear; recovery itself no-ops when nothing is active.
         */
        if (reconnectExhaustedRecheckTimerRef.current) {
          clearTimeout(reconnectExhaustedRecheckTimerRef.current)
        }
        reconnectExhaustedRecheckTimerRef.current = setTimeout(() => {
          reconnectExhaustedRecheckTimerRef.current = null
          void recoverActiveStreamRef.current('exhausted_recheck')
        }, RECONNECT_EXHAUSTED_RECHECK_MS)
      }
      return false
    },
    [resumeOrFinalize, setTransportIdle, setTransportReconnecting]
  )
  retryReconnectRef.current = retryReconnect

  const recoverActiveStreamFromRedis = useCallback(
    async (reason: ActiveStreamRecoveryReason): Promise<void> => {
      const startingChatId = chatIdRef.current
      const startingSelectedChatId = selectedChatIdRef.current
      const chatId = startingChatId ?? startingSelectedChatId
      if (!chatId) return

      const subjectKey = buildRecoverySubjectKey(startingChatId, startingSelectedChatId)
      /* A return signal supersedes a recovery already in flight, as it supersedes the
         send's own reader: that recovery's tail may have gone silent while the tab was
         away or offline, or it may be sleeping out a reconnect backoff, and either
         would hold the stream for up to the idle timeout or the backoff. */
      const existingRecovery = activeStreamReturnRecoveryRef.current
      if (existingRecovery) {
        existingRecovery.controller.abort(
          existingRecovery.subjectKey === subjectKey
            ? 'superseded_by_return'
            : 'replaced_by_new_recovery_subject'
        )
        activeStreamReturnRecoveryRef.current = null
      }

      const recoveryController = new AbortController()
      const recovery = (async () => {
        const observedGeneration = streamGenRef.current
        const isSameRecoverySubject = () =>
          chatIdRef.current === startingChatId &&
          selectedChatIdRef.current === startingSelectedChatId &&
          !recoveryController.signal.aborted

        const cached = queryClient.getQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(chatId)
        )
        const fallbackStreamId =
          streamIdRef.current ?? activeTurnRef.current?.userMessageId ?? cached?.activeStreamId
        const loadedStream = await getActiveStreamIdForChat(chatId, recoveryController.signal)
        /* The chat no longer lists a running turn, but this surface is still showing
           one: it ended while nothing here was listening (its reader went silent, or a
           recovery it superseded was attached). Resolve that stream instead of
           leaving it running: its terminal state replays the rest and finalizes. A
           send whose POST has not answered yet is such a stream only once the loaded
           chat holds its message (the server admitted it, and the answer is lost);
           until then it may still be on its way, and recovering it would abort it. */
        const pendingAdmission = pendingChatAdmissionRef.current
        const admitted =
          !pendingAdmission ||
          (loadedStream.loaded &&
            queryClient
              .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
              ?.messages.some((message) => message.id === pendingAdmission.userMessageId) === true)
        /* A POST still on its way owns this surface whatever the chat lists (another
           tab's turn, or nothing yet): recovering would abort it before the server
           answers, and that answer (the stream, or a busy refusal that re-queues the
           message) is what must decide what comes next. */
        if (!admitted) return
        const locallyRunningStreamId = sendingRef.current
          ? (streamIdRef.current ?? activeTurnRef.current?.userMessageId)
          : undefined
        const streamId = loadedStream.loaded
          ? (loadedStream.streamId ?? locallyRunningStreamId)
          : fallbackStreamId
        if (
          !isSameRecoverySubject() ||
          streamGenRef.current !== observedGeneration ||
          pendingStopPromiseRef.current !== null ||
          !streamId ||
          locallyTerminalStreamIdRef.current === streamId
        ) {
          return
        }

        const recoveryGen = observedGeneration + 1
        const previousStreamId = streamIdRef.current ?? activeTurnRef.current?.userMessageId
        const afterCursor = previousStreamId === streamId ? lastCursorRef.current || '0' : '0'
        streamGenRef.current = recoveryGen
        setTransportReconnecting()
        streamIdRef.current = streamId

        const replacedController = abortControllerRef.current
        if (replacedController && !replacedController.signal.aborted) {
          replacedController.abort('superseded_recovery')
        }

        const replacedReader = streamReaderRef.current
        streamReaderRef.current = null
        void replacedReader?.cancel().catch((error) => {
          logger.warn('Failed to cancel superseded stream reader during recovery', {
            chatId,
            streamId,
            error: toError(error).message,
          })
        })

        abortControllerRef.current = recoveryController

        logger.info('Recovering active stream after browser return', {
          reason,
          chatId,
          streamId,
          fromGeneration: observedGeneration,
          toGeneration: recoveryGen,
        })

        if (
          streamGenRef.current !== recoveryGen ||
          pendingStopPromiseRef.current !== null ||
          !isSameRecoverySubject()
        ) {
          return
        }
        if (locallyTerminalStreamIdRef.current === streamId) return

        const assistantId = getLiveAssistantMessageId(streamId)

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen: recoveryGen,
            afterCursor,
            signal: recoveryController.signal,
            targetChatId: chatId,
            shouldContinue: isSameRecoverySubject,
          })
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return
          }
          logger.warn('Active stream recovery failed', {
            reason,
            chatId,
            streamId,
            error: toError(error).message,
          })

          const succeeded = await retryReconnectRef.current({
            streamId,
            assistantId,
            gen: recoveryGen,
            targetChatId: chatId,
            shouldContinue: isSameRecoverySubject,
          })
          if (!succeeded && streamGenRef.current === recoveryGen && isSameRecoverySubject()) {
            finalizeRef.current({ error: true, targetChatId: chatId, streamTerminal: false })
          }
        }
      })()

      activeStreamReturnRecoveryRef.current = {
        subjectKey,
        controller: recoveryController,
        promise: recovery,
      }
      try {
        await recovery
      } finally {
        if (activeStreamReturnRecoveryRef.current?.promise === recovery) {
          activeStreamReturnRecoveryRef.current = null
        }
      }
    },
    [getActiveStreamIdForChat, queryClient, resumeOrFinalize, setTransportReconnecting]
  )
  recoverActiveStreamRef.current = recoverActiveStreamFromRedis

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const recoverIfChatSelected = (reason: 'pageshow' | 'visible' | 'online') => {
      if (!chatIdRef.current && !selectedChatIdRef.current) return
      void recoverActiveStreamFromRedis(reason)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverIfChatSelected('visible')
      }
    }

    const handlePageShow = () => {
      recoverIfChatSelected('pageshow')
    }

    const handleOnline = () => {
      recoverIfChatSelected('online')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('online', handleOnline)
      if (reconnectExhaustedRecheckTimerRef.current) {
        clearTimeout(reconnectExhaustedRecheckTimerRef.current)
        reconnectExhaustedRecheckTimerRef.current = null
      }
    }
  }, [recoverActiveStreamFromRedis])

  const persistStoppedResponse = useCallback(
    async (overrides?: {
      chatId?: string
      streamId?: string
      // `stopGeneration` must snapshot these BEFORE clearActiveTurn()
      // nulls the refs, or the fetch sees undefined.
      requestId?: string
      traceparent?: string
    }) => {
      const chatId = overrides?.chatId ?? chatIdRef.current
      const streamId = overrides?.streamId ?? streamIdRef.current
      if (!chatId || !streamId) return

      const requestId = overrides?.requestId ?? streamRequestIdRef.current
      const traceparent = overrides?.traceparent ?? streamTraceparentRef.current

      try {
        const res = await fetch(stopPathRef.current, {
          method: 'POST',
          signal: createTimeoutSignal(STOP_REQUEST_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            ...(traceparent ? { traceparent } : {}),
          },
          body: JSON.stringify({
            chatId,
            streamId,
            ...(requestId ? { requestId } : {}),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to persist partial response'
          )
        }
        if (!overrides || streamIdRef.current === streamId) {
          streamingContentRef.current = ''
          streamingBlocksRef.current = []
        }
      } catch (err) {
        logger.warn('Failed to persist partial response', err)
        throw err instanceof Error ? err : new Error('Failed to persist partial response')
      }
    },
    []
  )

  const invalidateChatQueries = useCallback(
    (options?: { includeDetail?: boolean; targetChatId?: string }) => {
      const activeChatId = options?.targetChatId ?? chatIdRef.current
      if (options?.includeDetail !== false && activeChatId) {
        queryClient.invalidateQueries({
          queryKey: mothershipChatKeys.detail(activeChatId),
        })
      }
      queryClient.invalidateQueries<readonly unknown[]>({
        queryKey: organizationId
          ? mothershipChatKeys.organizationList(organizationId)
          : mothershipChatKeys.list(workspaceId),
      })
    },
    [workspaceId, organizationId, scopeKey, queryClient]
  )

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  /**
   * Tells downstream consumers a turn ended, then settles the messages sent into
   * it and sends on whatever waited for it. Called from both the normal-completion
   * path (`finalize`) and the Stop path (`stopGeneration`), once per terminal
   * transition.
   */
  const notifyTurnEnded = useCallback((options: { error: boolean }) => {
    if (!options.error) {
      const cid = chatIdRef.current
      if (cid && onStreamEndRef.current) {
        onStreamEndRef.current(cid, messagesRef.current)
      }
    }
    deliverOutgoingRef.current()
  }, [])

  const finalize = useCallback(
    (options?: FinalizeOptions) => {
      const isError = !!options?.error
      if (isError) {
        const blocks = streamingBlocksRef.current
        if (finalizeResidualToolCalls(blocks, 'error')) {
          const assistantId =
            activeTurnRef.current?.assistantMessageId ??
            (streamIdRef.current ? getLiveAssistantMessageId(streamIdRef.current) : undefined)
          const activeChatId = options?.targetChatId ?? chatIdRef.current
          if (assistantId && activeChatId) {
            const snapshot = buildAssistantSnapshotMessage({
              id: assistantId,
              ...(streamIdRef.current ? { streamId: streamIdRef.current } : {}),
              content: streamingContentRef.current,
              contentBlocks: blocks,
              ...(streamRequestIdRef.current ? { requestId: streamRequestIdRef.current } : {}),
            })
            upsertChatHistory(activeChatId, (current) => ({
              ...current,
              messages: current.messages.map((message) =>
                message.id === assistantId ? snapshot : message
              ),
            }))
          } else if (assistantId) {
            setPendingMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, contentBlocks: [...blocks] } : message
              )
            )
          }
        }
      }
      /** A message waiting on this turn goes out next, so the chat is not done yet. */
      const hasFollowUp =
        !isError &&
        hasOutgoingFollowUp(
          outgoingRef.current.filter((message) => message.chatKey === chatKeyRef.current),
          appliedSteeringIds(streamingBlocksRef.current, new Set(appliedSteeringIdsSeen))
        )
      if (isError) {
        const erroredStreamId = streamIdRef.current ?? activeTurnRef.current?.userMessageId
        if (erroredStreamId) erroredStreamIds.add(erroredStreamId)
        writeOutgoing((current) => holdAfterErroredTurn(current, chatKeyRef.current))
      }
      const completedChatId = options?.targetChatId ?? chatIdRef.current
      if (!isError && !hasFollowUp && completedChatId) {
        void getDesktopBridge()?.settings?.notify({
          title: 'Task complete',
          body: 'Sim finished responding.',
          route: organizationId
            ? `/o/${organizationId}/chat/${completedChatId}`
            : `/workspace/${workspaceId}/chat/${completedChatId}`,
        })
      }
      reconcileTerminalPreviewSessions()
      const completedActivityTracker = resourceActivityTrackerRef.current
      if (completedActivityTracker?.generation === streamGenRef.current) {
        clearResourceActivity(completedActivityTracker, true)
      }
      const terminalStreamId =
        options?.streamTerminal !== false
          ? (streamIdRef.current ?? activeTurnRef.current?.userMessageId ?? undefined)
          : undefined
      if (options?.streamTerminal !== false) {
        locallyTerminalStreamIdRef.current = terminalStreamId
        if (terminalStreamId) endedStreamIds.add(terminalStreamId)
      }
      let completed: CompletedTurn | null = null
      if (
        terminalStreamId &&
        completedChatId &&
        (streamingContentRef.current || streamingBlocksRef.current.length > 0)
      ) {
        const userMessage =
          pendingUserMsgRef.current?.id === terminalStreamId
            ? pendingUserMsgRef.current
            : queryClient
                .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(completedChatId))
                ?.messages.find(
                  (message) => message.role === 'user' && message.id === terminalStreamId
                )
        if (userMessage) {
          completed = {
            chatId: completedChatId,
            userMessage,
            assistantMessage: buildAssistantSnapshotMessage({
              id: getLiveAssistantMessageId(terminalStreamId),
              streamId: terminalStreamId,
              content: streamingContentRef.current,
              contentBlocks: streamingBlocksRef.current,
              ...(streamRequestIdRef.current ? { requestId: streamRequestIdRef.current } : {}),
            }),
          }
        }
      }
      appliedSteeringIds(streamingBlocksRef.current, appliedSteeringIdsSeen)
      updateCompletedTurn(completed)
      clearActiveTurn()
      setTransportIdle()
      abortControllerRef.current = null
      invalidateChatQueries({
        includeDetail: !hasFollowUp,
        ...(options?.targetChatId ? { targetChatId: options.targetChatId } : {}),
      })
      if (terminalStreamId && completedChatId && (!isError || completed)) {
        void awaitPersistedTurn(completedChatId, terminalStreamId, completed !== null)
      }
      notifyTurnEnded({ error: isError })
    },
    [
      awaitPersistedTurn,
      clearResourceActivity,
      clearActiveTurn,
      invalidateChatQueries,
      notifyTurnEnded,
      reconcileTerminalPreviewSessions,
      setTransportIdle,
      updateCompletedTurn,
      upsertChatHistory,
      queryClient,
      workspaceId,
    ]
  )
  finalizeRef.current = finalize

  const startSendMessage = useCallback(
    async (
      message: string,
      fileAttachments?: FileAttachmentForApi[],
      suppliedContexts?: ChatContext[],
      options?: StartSendMessageOptions
    ): Promise<StartSendMessageResult> => {
      options = { ...options, requestMode: options?.requestMode ?? requestModeRef.current }
      const contexts = suppliedContexts && withTableViews(suppliedContexts)

      if ((!message.trim() && !fileAttachments?.length) || !scopeKey) return false
      if (chatPlanRequired) return false

      let consumedByTranscript = false
      let sendReachedServer = false

      setError(null)
      setTransportStreaming()

      /* A retry reuses its earlier attempt's id so the server deduplicates the
         two; anything else mints a fresh one. */
      const userMessageId = options?.userMessageId ?? generateId()
      const assistantId = getLiveAssistantMessageId(userMessageId)

      const storedAttachments: PersistedFileAttachment[] | undefined =
        fileAttachments && fileAttachments.length > 0
          ? fileAttachments.map((f) => ({
              id: f.id,
              key: f.key,
              filename: f.filename,
              media_type: f.media_type,
              size: f.size,
            }))
          : undefined

      let requestChatId = selectedChatIdRef.current ?? chatIdRef.current
      // Read before the composer can unmount. Sent only when picked; otherwise the server
      // uses the chat's stored pick or the default.
      const effortStore = useMothershipEffortStore.getState()
      const effortChoice =
        options?.requestMode === 'assistant'
          ? undefined
          : requestChatId
            ? (effortStore.chatEfforts[requestChatId]?.effort ??
              queryClient.getQueryData<MothershipChatHistory>(
                mothershipChatKeys.detail(requestChatId)
              )?.effort)
            : effortStore.newChatEffort
      /* Moves the new-chat pick onto the chat a send opened and saves it there unless it is
         the pick this send's admission stored. A pick changed while the send was pending,
         or a chat an earlier attempt opened with an unknown pick, gets the latest one. */
      const adoptNewChatEffort = (chatId: string, admittedThisSend: boolean) => {
        if (options?.requestMode === 'assistant') return
        const store = useMothershipEffortStore.getState()
        const latestChoice = store.newChatEffort ?? effortChoice
        if (!latestChoice) return
        store.adoptNewChatEffort(chatId, latestChoice)
        if (!admittedThisSend || latestChoice !== effortChoice)
          saveMothershipChatEffort(queryClient, chatId, latestChoice)
      }
      const payload = sendPayload({
        content: message,
        fileAttachments,
        contexts,
        requestMode: options?.requestMode,
        assistantSearch: options?.assistantSearch,
        assistantSearchLevel: options?.assistantSearchLevel,
      })
      const messageContexts = toMessageContexts(contexts)
      const cachedUserMsg: PersistedMessage = {
        id: userMessageId,
        streamId: userMessageId,
        role: 'user' as const,
        requestMode: options?.requestMode ?? 'agent',
        content: message,
        timestamp: new Date().toISOString(),
        ...(storedAttachments && { fileAttachments: storedAttachments }),
        ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
      }
      pendingUserMsgRef.current = cachedUserMsg

      const optimisticUserMessage: ChatMessage = {
        ...optimisticUserMessageFor(userMessageId, payload),
        streamId: userMessageId,
      }
      const optimisticAssistantMessage: ChatMessage = {
        id: assistantId,
        streamId: userMessageId,
        role: 'assistant',
        requestMode: options?.requestMode ?? 'agent',
        content: '',
        contentBlocks: [],
      }

      const cancelledQuery = requestChatId
        ? queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(requestChatId) })
        : Promise.resolve()

      const applyOptimisticSend = () => {
        const completed = completedTurnRef.current
        const assistantSnapshot = buildAssistantSnapshotMessage({
          id: assistantId,
          streamId: userMessageId,
          content: '',
          contentBlocks: [],
        })
        if (requestChatId) {
          upsertChatHistory(requestChatId, (current) => ({
            ...current,
            resources: current.resources.filter((resource) => resource.id !== 'streaming-file'),
            messages: [
              ...(completed && completed.chatId === requestChatId
                ? retainCompletedTurn(current.messages, completed)
                : current.messages
              ).filter(
                (persistedMessage) =>
                  persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
              ),
              cachedUserMsg,
              assistantSnapshot,
            ],
            activeStreamId: userMessageId,
          }))
        }
        updateCompletedTurn(null)

        setPendingMessages((prev) => {
          const nextMessages = prev.filter((m) => m.id !== userMessageId && m.id !== assistantId)
          return [...nextMessages, optimisticUserMessage, optimisticAssistantMessage]
        })
      }

      const rollbackOptimisticSend = () => {
        if (requestChatId) {
          upsertChatHistory(requestChatId, (current) => ({
            ...current,
            messages: current.messages.filter(
              (persistedMessage) =>
                persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
            ),
            activeStreamId:
              current.activeStreamId === userMessageId ? null : current.activeStreamId,
          }))
        }

        setPendingMessages((prev) =>
          prev.filter(
            (pendingMessage) =>
              pendingMessage.id !== userMessageId && pendingMessage.id !== assistantId
          )
        )
      }

      /* Publish identity before any asynchronous preparation, including query
         cancellation, so a Stop or a follow-up sent meanwhile finds this turn. */
      const gen = ++streamGenRef.current
      locallyTerminalStreamIdRef.current = undefined
      streamIdRef.current = userMessageId
      lastCursorRef.current = '0'
      resetStreamingBuffers()
      activeTurnRef.current = {
        userMessageId,
        assistantMessageId: assistantId,
        optimisticUserMessage,
        optimisticAssistantMessage,
        pendingChatKey: pendingChatKeyRef.current,
        desktopScopeId: desktopScopeIdRef.current,
      }
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      let resolveAdmission: ((chatId: string | undefined) => void) | undefined
      const admission: PendingChatAdmission = {
        userMessageId,
        chatKey: chatKeyRef.current,
        controller: abortController,
        settled: new Promise((resolve) => {
          resolveAdmission = resolve
        }),
        send: { ...payload, userMessageId },
      }
      pendingChatAdmissionRef.current = admission
      applyOptimisticSend()
      consumedByTranscript = true
      let streamTargetChatId = requestChatId

      try {
        await cancelledQuery

        const resourceAttachments =
          options?.requestMode === 'assistant'
            ? undefined
            : buildResourceAttachments(
                resourcesRef.current,
                activeResourceIdRef.current,
                desktopScopeIdRef.current,
                tableViewContextsRef.current.views
              )
        const desktopChatCapabilities =
          options?.requestMode === 'assistant'
            ? {}
            : await getDesktopChatCapabilities(
                desktopScopeIdRef.current,
                !computerUseEnabled
                  ? null
                  : organizationId
                    ? { organizationId }
                    : workspaceId
                      ? { workspaceId }
                      : null
              )

        const response = await fetch(apiPathRef.current, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            ...(organizationId ? { organizationId } : { workspaceId }),
            userMessageId,
            ...(options?.steeringFallback ? { steeringFallback: true } : {}),
            createNewChat: !requestChatId,
            ...(requestChatId ? { chatId: requestChatId } : {}),
            ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
            ...(resourceAttachments ? { resourceAttachments } : {}),
            ...(contexts && contexts.length > 0 ? { contexts } : {}),
            ...(options?.requestMode ? { mode: options.requestMode } : {}),
            ...(options?.assistantSearch ? { assistantSearch: options.assistantSearch } : {}),
            ...(options?.requestMode === 'assistant' && options.assistantSearchLevel
              ? { assistantSearchLevel: options.assistantSearchLevel }
              : {}),
            ...(options?.requestMode !== 'assistant' && workflowIdRef.current
              ? { workflowId: workflowIdRef.current }
              : {}),
            // Desktop-only capabilities (local filesystem tools, browser
            // subagent) — the server gates the features on these flags.
            ...desktopChatCapabilities,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(options?.requestMode !== 'assistant'
              ? {
                  modelSelection: resolveMothershipModelSettings(
                    (options?.requestMode === 'plan'
                      ? useMothershipPlanEffortStore
                      : useMothershipEffortStore
                    ).getState(),
                    modelSelectorEnabled,
                    options?.requestMode === 'plan'
                  ).modelSelection,
                  ...(effortChoice ? { effort: effortChoice } : {}),
                }
              : {}),
          }),
          signal: abortController.signal,
        })
        sendReachedServer = true
        const admittedChatId = response.ok
          ? (response.headers.get(MOTHERSHIP_CHAT_ID_HEADER) ?? requestChatId)
          : undefined
        resolveAdmission?.(admittedChatId)
        if (pendingChatAdmissionRef.current === admission) pendingChatAdmissionRef.current = null
        /* The user moved on (another chat) while the POST was out. A conflict is still
           handled below: it means the message was not admitted, and the chat that holds
           it must learn of the turn that refused it. */
        if (streamGenRef.current !== gen && response.status !== 409) {
          await response.body?.cancel()
          return consumedByTranscript
        }
        if (admittedChatId && !requestChatId) {
          adoptNewChatEffort(admittedChatId, true)
          requestChatId = admittedChatId
          streamTargetChatId = admittedChatId
          adoptResolvedChatId(admittedChatId, { replaceHomeHistory: true, invalidateList: true })
        }

        // Capture for propagation on side-channel calls + non-React
        // tool-completion callbacks (via trace-context singleton).
        const traceparent = response.headers.get('traceparent')
        if (traceparent) {
          streamTraceparentRef.current = traceparent
          setCurrentChatTraceparent(traceparent)
          const traceId = traceparent.split('-')[1] ?? ''
          if (/^[0-9a-f]{32}$/.test(traceId)) {
            try {
              onRequestStartedRef.current?.({ requestId: traceId, userMessageId })
            } catch (callbackError) {
              logger.warn('onRequestStarted callback threw', { error: callbackError })
            }
          }
        }

        /* The message was already applied as steering in an earlier run of this chat,
           so the conversation has it: no answer is coming, and the message shows as the
           steering record it is until the saved chat places it in that run. */
        const settleAppliedInput = () => {
          appliedSteeringIdsSeen.add(userMessageId)
          if (requestChatId) {
            upsertChatHistory(requestChatId, (current) => ({
              ...current,
              messages: current.messages.flatMap((persisted) =>
                persisted.id === assistantId
                  ? []
                  : persisted.id === userMessageId
                    ? [{ ...persisted, steering: { streamId: userMessageId } }]
                    : [persisted]
              ),
              activeStreamId:
                current.activeStreamId === userMessageId ? null : current.activeStreamId,
            }))
          }
          if (streamGenRef.current === gen) {
            streamGenRef.current++
            abortControllerRef.current = null
            clearActiveTurn()
            setTransportIdle()
          }
          if (requestChatId) {
            void queryClient.invalidateQueries({
              queryKey: mothershipChatKeys.detail(requestChatId),
              exact: true,
            })
          }
          deliverOutgoingRef.current()
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          if (response.status === 409 && errorData.code === 'input_applied') {
            settleAppliedInput()
            return consumedByTranscript
          }
          if (response.status === 409) {
            /* A deduplicated send always names itself; a chat busy with another
               turn names that turn, or nothing when its stream id is unreadable. */
            const conflictStreamId =
              typeof errorData.activeStreamId === 'string' ? errorData.activeStreamId : undefined
            /** Whether this view still shows the send; otherwise only its own chat changes. */
            const viewOnSend = streamGenRef.current === gen
            /** Withdraws this refused send so its caller can deliver it another way. */
            const releaseRefusedSend = () => {
              rollbackOptimisticSend()
              if (streamGenRef.current === gen) {
                streamGenRef.current++
                abortController.abort('send_conflict:chat_busy')
                abortControllerRef.current = null
                clearActiveTurn()
                setTransportIdle()
              }
            }
            if (conflictStreamId !== userMessageId) {
              /* Another turn holds the chat: one started in another tab, or one this
                 surface lost track of. This message was not admitted (the server
                 released its id). The chat records the turn the refusal names, this
                 view attaches to it, and the caller steers the message into it. */
              releaseRefusedSend()
              if (requestChatId && conflictStreamId) {
                upsertChatHistory(requestChatId, (current) => ({
                  ...current,
                  activeStreamId: conflictStreamId,
                }))
              }
              if (viewOnSend) void recoverActiveStreamRef.current('busy_refusal')
              else if (requestChatId)
                void queryClient.invalidateQueries({
                  queryKey: mothershipChatKeys.detail(requestChatId),
                  exact: true,
                  refetchType: 'none',
                })
              return conflictStreamId
                ? { userMessageId, reason: 'busy', streamId: conflictStreamId }
                : { userMessageId, reason: 'unsent' }
            }
            /* "Already sent" with no stream for it means the earlier attempt is still
               in flight on the server (or died before starting a turn), not that a turn
               ran: reattaching would read the missing stream as finished and drop the
               message. Hand it back for a later retry under the same id; the server's
               claim settles meanwhile. A lookup that fails for another reason proves
               nothing either way, so it is retried on purpose; that includes the
               lookup's own timeout abort, which leaves this send's signal untouched.
               Only an abort of this send itself (Stop, or the user moving on) is not. */
            const dedupedStreamExists = await fetchStreamBatch(
              conflictStreamId,
              '0',
              abortController.signal
            ).then(
              () => true,
              (error: unknown) => !isStreamGoneError(error) && abortController.signal.aborted
            )
            if (!dedupedStreamExists) {
              releaseRefusedSend()
              return { userMessageId, reason: 'unsent' }
            }
            /** The user may have moved on (another chat, another send) during the check. */
            if (streamGenRef.current !== gen) return consumedByTranscript
            /* A send deduplicated against an earlier attempt comes back naming
               the chat that attempt opened. Adopting it here spares a chatless
               surface the stream-to-chat lookup and puts the user in the right
               chat before the reconnect below replays it. */
            const conflictChatId =
              typeof errorData.chatId === 'string' ? errorData.chatId : undefined
            if (conflictChatId && !streamTargetChatId) {
              adoptNewChatEffort(conflictChatId, false)
              adoptResolvedChatId(conflictChatId, {
                replaceHomeHistory: true,
                invalidateList: true,
              })
              streamTargetChatId = conflictChatId
            }
            streamIdRef.current = conflictStreamId
            const succeeded = await retryReconnect({
              streamId: conflictStreamId,
              assistantId,
              gen,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            if (succeeded) return consumedByTranscript
            if (streamGenRef.current === gen) {
              finalize({
                error: true,
                ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
              })
            }
            return consumedByTranscript
          }
          /** An explicit rejection never admitted a run, so there is nothing to reconnect. */
          setError(
            typeof errorData.error === 'string'
              ? errorData.error
              : `Request failed: ${response.status}`
          )
          finalize({
            error: true,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
          return consumedByTranscript
        }

        if (!response.body) throw new Error('No response body')

        const streamResult = await processSSEStream(response.body.getReader(), assistantId, gen, {
          ...(response.headers.get(MOTHERSHIP_DESKTOP_EXECUTOR_HEADER) === 'device'
            ? { desktopToolsOnDevice: true }
            : {}),
          ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
        })
        if (streamResult.inputApplied && streamGenRef.current === gen) {
          settleAppliedInput()
          return consumedByTranscript
        }
        if (streamGenRef.current === gen) {
          if (streamResult.sawStreamError) {
            finalize({
              error: true,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            return consumedByTranscript
          }

          // A live SSE `complete` event is already terminal. Finalize immediately so a
          // follow-up does not wait on, or steer into, an already-finished response.
          if (streamResult.sawComplete) {
            finalize({
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            return consumedByTranscript
          }

          await resumeOrFinalize({
            streamId: streamIdRef.current || userMessageId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortController.signal,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
          if (streamGenRef.current === gen && sendingRef.current) {
            finalize({
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
          }
        }
      } catch (err) {
        /* fetch rejects with the RAW abort reason (here a plain string) when
           its signal was aborted with abort(reason) — an `err.name` check alone
           misses those, so abort detection also consults the signal itself. */
        const sendWasAborted =
          (err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted
        if (sendWasAborted) {
          if (abortController.signal.reason === 'unmount:client_cleanup' && !sendReachedServer) {
            /* A remount ran the unmount cleanup before this send's response
               arrived — a chat-route `key` change, or StrictMode's dev
               double-mount. Nothing was rendered from it, so withdraw the
               optimistic pair and report the message id, which a retry reuses.

               The request itself may well have been accepted: the route never
               reads `request.signal`, so it runs to completion regardless of
               the abort. Reusing the id is what makes the retry safe — the
               server deduplicates it against that turn instead of billing
               another one. */
            rollbackOptimisticSend()
            return { userMessageId, reason: 'withdrawn' }
          }
          return consumedByTranscript
        }
        if (isStreamSchemaValidationError(err)) {
          setError(err.message)
          if (streamGenRef.current === gen) {
            finalize({
              error: true,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
          }
          return consumedByTranscript
        }

        if (!sendReachedServer) {
          /* The POST got no answer, so nothing shows the server admitted it, and a
             stream that was never opened reads as finished. Hand the message back
             under the same id: if the server did admit it, the retry deduplicates
             and the chat's own recovery shows the running turn. */
          rollbackOptimisticSend()
          if (streamGenRef.current === gen) {
            streamGenRef.current++
            abortController.abort('send_unreachable:no_response')
            abortControllerRef.current = null
            clearActiveTurn()
            setTransportIdle()
          }
          setError(
            err instanceof TypeError
              ? `Message not sent: Sim could not be reached. ${
                  navigator.onLine ? 'Retrying.' : 'It will send when you are back online.'
                }`
              : getErrorMessage(err, 'Failed to send message')
          )
          return { userMessageId, reason: 'unsent' }
        }

        const activeStreamId = streamIdRef.current
        if (activeStreamId && streamGenRef.current === gen) {
          const succeeded = await retryReconnect({
            streamId: activeStreamId,
            assistantId,
            gen,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
          if (succeeded) return consumedByTranscript
        }

        setError(getErrorMessage(err, 'Failed to send message'))
        if (streamGenRef.current === gen) {
          finalize({
            error: true,
            streamTerminal: false,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
        }
        return consumedByTranscript
      } finally {
        resolveAdmission?.(undefined)
        if (pendingChatAdmissionRef.current === admission) pendingChatAdmissionRef.current = null
      }
      return consumedByTranscript
    },
    [
      workspaceId,
      organizationId,
      scopeKey,
      chatPlanRequired,
      queryClient,
      upsertChatHistory,
      modelSelectorEnabled,
      computerUseEnabled,
      processSSEStream,
      finalize,
      resumeOrFinalize,
      retryReconnect,
      fetchStreamBatch,
      clearActiveTurn,
      resetStreamingBuffers,
      updateCompletedTurn,
      adoptResolvedChatId,
      setTransportIdle,
      setTransportStreaming,
      appliedSteeringIdsSeen,
    ]
  )
  /**
   * Hands a send the unmount cleanup withdrew to whatever chat surface comes
   * next: the live replacement's listener when one is mounted, else a one-shot
   * stored handoff for the next mount. Both lanes carry `userMessageId`, so
   * whoever picks it up retries as the same send rather than a new one.
   */
  const handOffWithdrawnSend = useCallback(
    (send: WithdrawnSend) => {
      const payload = sendPayload(send)
      if (sendMothershipMessage(payload, send.userMessageId)) return
      const { content, ...payloadFields } = payload
      MothershipHandoffStorage.store(
        { message: content, ...payloadFields, resumeUserMessageId: send.userMessageId },
        organizationId ? { organizationId } : workspaceId!
      )
    },
    [workspaceId, organizationId]
  )

  /**
   * A provisional key dies with this mount, so what it holds goes on to the next
   * surface, in order: the first through the handoff, under its id, and the rest in
   * the journal for the surface that resumes it, since a stored handoff holds one.
   */
  const handOffProvisionalOutgoing = useCallback(
    (chatKey: string) => {
      const undelivered = outgoingRef.current.filter(
        (message) =>
          message.chatKey === chatKey &&
          message.status !== 'steered' &&
          message.status !== 'applied'
      )
      writeOutgoing((current) => current.filter((message) => message.chatKey !== chatKey))
      const resumed = undelivered.find((message) => message.status !== 'failed')
      if (!resumed) return
      const behind = undelivered.filter((message) => message !== resumed).map(toHandedOff)
      if (behind.length > 0) {
        useMothershipOutgoingStore.getState().record(handedOffJournalKey(resumed.id), behind)
      }
      handOffWithdrawnSend({ ...resumed.payload, userMessageId: resumed.id })
    },
    [handOffWithdrawnSend, writeOutgoing]
  )

  /**
   * The turn a message sent now would steer: the running one, or the one whose
   * admission is still out in this chat (a message waits for that answer rather
   * than open a second chat). None while a Stop is out or nothing runs.
   */
  const liveStreamId = useCallback((): string | undefined => {
    if (pendingStopPromiseRef.current) return undefined
    const admission = pendingChatAdmissionRef.current
    if (admission?.chatKey === chatKeyRef.current) return admission.userMessageId
    if (!sendingRef.current) return undefined
    return streamIdRef.current ?? activeTurnRef.current?.userMessageId
  }, [])

  const updateOutgoing = useCallback(
    (id: string, patch: Partial<OutgoingMessage>) =>
      writeOutgoing((current) =>
        current.map((message) => (message.id === id ? { ...message, ...patch } : message))
      ),
    [writeOutgoing]
  )

  /**
   * Retries a message that came back undelivered on a growing delay, or, while the
   * browser is offline, once it is back online (the `online` listener below).
   */
  const deferOutgoing = useCallback(
    (id: string) => {
      const message = outgoingRef.current.find((candidate) => candidate.id === id)
      if (!message) return
      updateOutgoing(id, afterUnsentAttempt(message, { online: navigator.onLine, now: Date.now() }))
    },
    [updateOutgoing]
  )

  /** Shows a steered message in its chat's cached history as the server stores it. */
  const recordSteeredMessage = useCallback(
    (chatId: string, message: OutgoingMessage, streamId: string) => {
      upsertChatHistory(chatId, (current) =>
        current.messages.some((existing) => existing.id === message.id)
          ? current
          : {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: message.id,
                  role: 'user',
                  content: message.payload.content,
                  timestamp: new Date().toISOString(),
                  ...(message.payload.requestMode
                    ? { requestMode: message.payload.requestMode }
                    : {}),
                  steering: { streamId },
                },
              ],
            }
      )
    },
    [upsertChatHistory]
  )

  /**
   * Asks the worker what became of a steering message, sending it if it never
   * arrived. The same id and content read the earlier attempt's disposition, so a
   * repeat never steers twice. `unknown`: no answer, so it may or may not be held.
   */
  const requestSteering = useCallback(
    async (
      message: OutgoingMessage,
      streamId: string,
      chatId: string
    ): Promise<SteeringOutcome> => {
      const { content, contexts, fileAttachments } = message.payload
      try {
        const disposition = await requestJson(copilotChatSteerContract, {
          signal: AbortSignal.timeout(STEER_REQUEST_TIMEOUT_MS),
          body: {
            streamId,
            chatId,
            steeringId: message.id,
            content,
            /* The composer's contexts are what a turn's body carries; the route
               validates them with the turn's own schema. */
            ...(contexts?.length
              ? { contexts: withTableViews(contexts) as CopilotChatSteerBody['contexts'] }
              : {}),
            ...(fileAttachments?.length ? { fileAttachments } : {}),
          },
        })
        return disposition.status === 'applied'
          ? {
              status: 'applied',
              ...(disposition.textOffset !== undefined
                ? { textOffset: disposition.textOffset }
                : {}),
            }
          : { status: disposition.status }
      } catch (error) {
        /* 409: no live run took it, or the worker refused it; 404: the run it names
           was never admitted; 400: it is not a message steering can carry. No turn
           holds it, so it goes out as a turn of its own. */
        if (
          isApiClientError(error) &&
          (error.status === 409 || error.status === 404 || error.status === 400)
        ) {
          return { status: 'not_applied' }
        }
        logger.warn('Steering request got no disposition', {
          streamId,
          steeringId: message.id,
          error: getErrorMessage(error),
        })
        return { status: 'unknown' }
      }
    },
    [withTableViews]
  )

  /** Steers a message into the running turn `streamId`, once that turn's admission settles. */
  const steerOutgoing = useCallback(
    async (message: OutgoingMessage, streamId: string) => {
      const refused = () => notSteered(streamId, erroredStreamIds.has(streamId))
      let chatId = chatKeyRef.current === message.chatKey ? chatIdRef.current : undefined
      const admission = pendingChatAdmissionRef.current
      if (admission?.userMessageId === streamId) {
        updateOutgoing(message.id, { status: 'steering', streamId })
        const admittedChatId = await admission.settled
        if (!admittedChatId) {
          updateOutgoing(message.id, refused())
          return
        }
        chatId = admittedChatId
      }
      if (!chatId) {
        updateOutgoing(message.id, refused())
        return
      }
      updateOutgoing(message.id, { status: 'steering', streamId })
      const outcome = await requestSteering(message, streamId, chatId)
      if (outcome.status === 'not_applied') {
        updateOutgoing(message.id, refused())
        return
      }
      if (outcome.status !== 'unknown') recordSteeredMessage(chatId, message, streamId)
      if (outcome.status === 'applied') {
        appliedSteeringIdsSeen.add(message.id)
        updateOutgoing(message.id, {
          status: 'applied',
          streamId,
          notBefore: undefined,
          ...(outcome.textOffset !== undefined ? { textOffset: outcome.textOffset } : {}),
        })
        return
      }
      updateOutgoing(message.id, {
        status: 'steered',
        streamId,
        unconfirmed: outcome.status === 'unknown',
      })
    },
    [
      appliedSteeringIdsSeen,
      erroredStreamIds,
      recordSteeredMessage,
      requestSteering,
      updateOutgoing,
    ]
  )

  /**
   * Resolves the messages steered into a turn that is no longer running. One the
   * turn applied (its `steering_applied` frame, or the worker says so) is done once
   * the chat's history holds the turn's marker for it. For one it did not, the
   * worker is asked again, from its durable record: `not_applied` (or a refusal)
   * sends it back to `pending` and out as a turn of its own; still `queued` or no
   * answer asks again later, since a message the worker holds must not run twice.
   */
  const settleOutgoing = useCallback(async () => {
    const chatKey = chatKeyRef.current
    const chatId = chatIdRef.current
    if (!chatId || pendingStopPromiseRef.current) return
    const history = queryClient.getQueryData<MothershipChatHistory>(
      mothershipChatKeys.detail(chatId)
    )
    const applied = new Set(appliedSteeringIdsSeen)
    for (const persisted of history?.messages ?? []) {
      appliedSteeringIds(persisted.contentBlocks, applied)
    }
    appliedSteeringIds(streamingBlocksRef.current, applied)
    const marked = new Set<string>()
    for (const persisted of history?.messages ?? [])
      appliedSteeringIds(persisted.contentBlocks, marked)
    const live = liveStreamId()
    const orphans = orphanSteeringRows(history, {
      known: new Set(outgoingRef.current.map((message) => message.id)),
      applied,
      marked,
      liveStreamId: live,
    })
    if (orphans.length > 0) {
      const now = Date.now()
      writeOutgoing((current) => [
        ...current,
        ...orphans.map((row) => adoptOrphanRow(row, chatKey, now)),
      ])
    }
    const admitted = admittedMessageIds(history)
    for (const message of outgoingRef.current) {
      if (message.chatKey !== chatKey) continue
      if (isDeliveredAsTurn(message, admitted)) {
        writeOutgoing((current) => current.filter((candidate) => candidate.id !== message.id))
        continue
      }
      if (!message.streamId) continue
      if (message.status === 'applied') {
        if (marked.has(message.id)) {
          writeOutgoing((current) => current.filter((candidate) => candidate.id !== message.id))
        }
        continue
      }
      if (message.status !== 'steered') continue
      const streamId = message.streamId
      if (streamId === live) continue
      /** A turn the chat still shows running, unless this surface saw it end. */
      if (streamId === history?.activeStreamId && !endedStreamIds.has(streamId)) continue
      if ((message.notBefore ?? 0) > Date.now()) continue
      if (applied.has(message.id)) {
        recordSteeredMessage(chatId, message, streamId)
        writeOutgoing((current) => current.filter((candidate) => candidate.id !== message.id))
        continue
      }
      const outcome = await requestSteering(message, streamId, chatId)
      updateOutgoing(
        message.id,
        afterDispositionRead(message, outcome, {
          streamId,
          turnErrored: erroredStreamIds.has(streamId),
          now: Date.now(),
        })
      )
      if (outcome.status === 'applied') {
        appliedSteeringIdsSeen.add(message.id)
        recordSteeredMessage(chatId, message, streamId)
        /* The turn's own marker for it arrives with the chat's saved transcript. */
        void queryClient.invalidateQueries({
          queryKey: mothershipChatKeys.detail(chatId),
          exact: true,
        })
      }
    }
  }, [
    appliedSteeringIdsSeen,
    endedStreamIds,
    erroredStreamIds,
    liveStreamId,
    queryClient,
    recordSteeredMessage,
    requestSteering,
    updateOutgoing,
    writeOutgoing,
  ])

  /**
   * Carries out what `nextOutgoingStep` decides for the current chat, until it has
   * to wait on something: a turn's end, a steer's answer, a retry's delay.
   */
  const pumpOutgoing = useCallback(async () => {
    while (surfaceMountedRef.current && !pendingStopPromiseRef.current) {
      const chatKey = chatKeyRef.current
      const chatId = chatIdRef.current
      const step = nextOutgoingStep(
        outgoingRef.current.filter((message) => message.chatKey === chatKey),
        {
          liveStreamId: liveStreamId(),
          admittedIds: admittedMessageIds(
            chatId
              ? queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
              : undefined
          ),
          now: Date.now(),
        }
      )
      if (step.kind === 'idle') return
      const { message } = step
      if (step.kind === 'drop') {
        writeOutgoing((current) => current.filter((candidate) => candidate.id !== message.id))
        continue
      }
      if (step.kind === 'steer') {
        await steerOutgoing(message, step.streamId)
        continue
      }
      const settled = () =>
        writeOutgoing((current) => current.filter((candidate) => candidate.id !== message.id))
      updateOutgoing(message.id, { status: 'sending' })
      const { content, fileAttachments, contexts, ...sendOptions } = message.payload
      const sent = startSendMessage(content, fileAttachments, contexts, {
        ...sendOptions,
        userMessageId: message.id,
        ...(message.refusedBy ? { steeringFallback: true } : {}),
      })
      outgoingTurnSends.set(message.id, sent)
      /* Admitted, it is the turn's own message: nothing is left to deliver. */
      const admission = pendingChatAdmissionRef.current
      if (admission?.userMessageId === message.id) {
        void admission.settled.then((chatId) => {
          if (chatId) settled()
        })
      }
      void sent.then((result) => {
        if (outgoingTurnSends.get(message.id) === sent) outgoingTurnSends.delete(message.id)
        if (result === false) {
          /* Nothing went out (the chat refused it before sending); it stays, shown
             as not delivered. */
          updateOutgoing(message.id, { status: 'failed', notBefore: undefined })
          return
        }
        if (typeof result !== 'object') {
          settled()
          return
        }
        if (result.reason === 'withdrawn') {
          /* An unmount withdrew it before the server answered. A chat's journal keeps
             it for the next mount of that chat; a new chat's goes to the next surface,
             with whatever was waiting on its admission. */
          if (message.chatKey.startsWith(PENDING_CHAT_KEY_PREFIX)) {
            handOffProvisionalOutgoing(message.chatKey)
          } else {
            updateOutgoing(message.id, { status: 'pending', unconfirmed: true })
          }
          return
        }
        /* Back at the head: it was first when it went out, and what was written
           after it stays behind it. */
        writeOutgoing((current) => [
          {
            ...message,
            status: 'pending',
            streamId: undefined,
            unconfirmed: false,
            reads: 0,
            notBefore: undefined,
          },
          ...current.filter((candidate) => candidate.id !== message.id),
        ])
        if (result.reason === 'busy') {
          /* Another turn holds the chat: this message steers that one. Every round
             of this counts, whatever the steer answers, so a chat that keeps refusing
             a message it never applies backs off and ends in "not delivered". */
          const attempts = message.attempts + 1
          if (attempts >= MAX_OUTGOING_DELIVERY_ATTEMPTS) {
            updateOutgoing(message.id, { status: 'failed', attempts, notBefore: undefined })
            return
          }
          updateOutgoing(message.id, { attempts })
          if (!canSteer(message.payload)) {
            updateOutgoing(message.id, { notBefore: Date.now() + outgoingRetryDelay(attempts) })
            deliverOutgoingRef.current()
            return
          }
          void steerOutgoing({ ...message, attempts }, result.streamId).then(() => {
            const current = outgoingRef.current.find((candidate) => candidate.id === message.id)
            if (current?.status === 'pending') {
              updateOutgoing(message.id, {
                notBefore: Date.now() + outgoingRetryDelay(attempts),
              })
            }
            deliverOutgoingRef.current()
          })
          return
        }
        deferOutgoing(message.id)
        deliverOutgoingRef.current()
      })
    }
  }, [
    deferOutgoing,
    handOffProvisionalOutgoing,
    liveStreamId,
    outgoingTurnSends,
    queryClient,
    startSendMessage,
    steerOutgoing,
    updateOutgoing,
    writeOutgoing,
  ])

  /**
   * One settle-then-send pass over the current chat's outgoing messages, run one
   * at a time; a request during a pass makes it go round again. Called whenever
   * something they wait on changes: a send, a turn's end, a Stop settling, the
   * browser coming online, the chat history moving on, and retry timers.
   */
  /** Whether this chat has a steered message, or a steering record, to settle. */
  const hasSteeringToSettle = useCallback(() => {
    const chatKey = chatKeyRef.current
    if (
      outgoingRef.current.some(
        (message) =>
          message.chatKey === chatKey &&
          (message.status === 'steered' ||
            message.status === 'applied' ||
            message.status === 'failed')
      )
    ) {
      return true
    }
    const chatId = chatIdRef.current
    if (!chatId) return false
    return queryClient
      .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
      ?.messages.some((message) => message.steering)
  }, [queryClient])

  const deliverOutgoing = useCallback((): Promise<void> => {
    const delivery = outgoingDeliveryRef.current
    if (delivery.pass) {
      delivery.again = true
      return delivery.pass
    }
    delivery.pass = (async () => {
      let passBegan = Date.now()
      try {
        do {
          delivery.again = false
          passBegan = Date.now()
          /* Checked synchronously so a plain send goes out in the same tick as
             `sendMessage`, before any await. */
          if (hasSteeringToSettle()) await settleOutgoing()
          await pumpOutgoing()
        } while (delivery.again && surfaceMountedRef.current)
      } catch (error) {
        logger.warn('Failed to deliver an outgoing message', { error: getErrorMessage(error) })
      } finally {
        delivery.pass = null
      }
      if (outgoingRetryTimerRef.current) clearTimeout(outgoingRetryTimerRef.current)
      outgoingRetryTimerRef.current = null
      const next = nextOutgoingWake(
        outgoingRef.current.filter((message) => message.chatKey === chatKeyRef.current),
        passBegan
      )
      if (surfaceMountedRef.current && Number.isFinite(next)) {
        outgoingRetryTimerRef.current = setTimeout(
          () => deliverOutgoingRef.current(),
          Math.max(0, next - Date.now())
        )
      }
    })()
    return delivery.pass
  }, [hasSteeringToSettle, pumpOutgoing, settleOutgoing])
  deliverOutgoingRef.current = deliverOutgoing

  const retryMessage = useCallback(
    (id: string) => {
      writeOutgoing((current) =>
        current.map((message) =>
          message.id === id && message.status === 'failed'
            ? { ...message, ...afterRetry(message) }
            : message
        )
      )
      void deliverOutgoing()
    },
    [deliverOutgoing, writeOutgoing]
  )

  /**
   * Gives up on a message shown as not delivered: it leaves this tab, and the server
   * drops its record unless a run applied it or still holds it, in which case it
   * stays where that leaves it. With no answer it stays as it is.
   */
  const dismissMessage = useCallback(
    async (id: string) => {
      const message = outgoingRef.current.find((candidate) => candidate.id === id)
      if (message?.status !== 'failed') return
      const remove = () =>
        writeOutgoing((current) => current.filter((candidate) => candidate.id !== id))
      const chatId = chatIdRef.current
      if (!chatId) {
        remove()
        return
      }
      try {
        /* A conflict means the worker holds other bytes under this id: nothing more can
           be learned, and the user asked for it gone. */
        const outcome = await requestJson(copilotChatDismissSteeringContract, {
          body: { chatId, steeringId: id },
        }).catch((error: unknown) => {
          if (isApiClientError(error) && error.status === 409) {
            return { status: 'dismissed' as const }
          }
          throw error
        })
        if (outcome.status === 'busy') {
          updateOutgoing(id, {
            status: 'steered',
            streamId: outcome.streamId,
            attempts: 0,
            reads: 0,
          })
          void deliverOutgoing()
          return
        }
        if (outcome.status === 'applied') {
          appliedSteeringIdsSeen.add(id)
          void queryClient.invalidateQueries({
            queryKey: mothershipChatKeys.detail(chatId),
            exact: true,
          })
        } else {
          upsertChatHistory(chatId, (current) => ({
            ...current,
            messages: current.messages.filter(
              (row) => row.id !== id || !row.steering || row.steering.streamId === row.id
            ),
          }))
        }
        remove()
      } catch (error) {
        logger.warn('Failed to dismiss a message', { messageId: id, error: getErrorMessage(error) })
      }
    },
    [
      appliedSteeringIdsSeen,
      deliverOutgoing,
      queryClient,
      updateOutgoing,
      upsertChatHistory,
      writeOutgoing,
    ]
  )

  const sendMessage = useCallback(
    async (
      message: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[],
      options?: SendMessageOptions
    ) => {
      if ((!message.trim() && !fileAttachments?.length) || !scopeKey) return
      if (chatPlanRequired) {
        useChatPlanModalStore.getState().open(workspaceId)
        return
      }
      const payload = sendPayload({
        content: message,
        fileAttachments,
        contexts,
        requestMode: options?.requestMode ?? requestModeRef.current,
        assistantSearch: options?.assistantSearch,
        assistantSearchLevel: options?.assistantSearchLevel,
      })
      const id = options?.resumeUserMessageId ?? generateId()
      const chatKey = chatKeyRef.current
      const journal = useMothershipOutgoingStore.getState()
      const handedOff = options?.resumeUserMessageId
        ? (journal.chats[handedOffJournalKey(id)] ?? [])
        : []
      if (handedOff.length > 0) journal.record(handedOffJournalKey(id), [])
      const now = Date.now()
      /* A new message is the user asking again, so anything held back in this chat
         (an unreachable Sim, a busy chat) tries again with it, ahead of it. */
      writeOutgoing((current) => [
        ...current.map((earlier) =>
          earlier.chatKey === chatKey && earlier.status === 'pending'
            ? { ...earlier, notBefore: undefined }
            : earlier
        ),
        {
          id,
          ...(options?.resumeUserMessageId ? { unconfirmed: true } : {}),
          chatKey,
          payload,
          display: optimisticUserMessageFor(id, payload),
          status: 'pending',
          attempts: 0,
          reads: 0,
          writtenAt: now,
        },
        ...handedOff.map((entry) => fromJournaled(chatKey, entry, now)),
      ])
      void deliverOutgoing()
      /* A message that goes straight out as its own turn resolves with that turn,
         as a send always has; one on its way into a running turn resolves now. */
      const sent = outgoingTurnSends.get(id)
      outgoingTurnSends.delete(id)
      await sent
    },
    [workspaceId, scopeKey, chatPlanRequired, deliverOutgoing, outgoingTurnSends, writeOutgoing]
  )

  /**
   * A history read that shows a steered turn has moved on (it ended elsewhere, or
   * this surface came back to the chat) settles what was sent into it, and the
   * browser coming back online retries what could not reach Sim.
   */
  const historyActiveStreamId = chatHistory?.activeStreamId ?? null
  const historyHoldsSteering = chatHistory?.messages.some((message) => message.steering) ?? false
  const admittedInHistory = outgoing.some((message) => message.status === 'failed')
    ? admittedMessageIds(chatHistory)
    : undefined
  const historyDeliveredAnEntry =
    admittedInHistory !== undefined &&
    outgoing.some((message) => isDeliveredAsTurn(message, admittedInHistory))
  useEffect(() => {
    /* A chat this mount has not delivered for yet resumes what its journal holds:
       an earlier mount's messages, under their ids and where their delivery stood. */
    if (!chatKey.startsWith(PENDING_CHAT_KEY_PREFIX)) {
      const journaled = useMothershipOutgoingStore.getState().chats[chatKey] ?? []
      const known = new Set(outgoingRef.current.map((message) => message.id))
      const restored = journaled.filter((entry) => !known.has(entry.id))
      if (restored.length > 0) {
        const now = Date.now()
        writeOutgoing((current) => [
          ...current,
          ...restored.map((entry) => fromJournaled(chatKey, entry, now)),
        ])
      }
    }
    if (
      historyHoldsSteering ||
      outgoingRef.current.some((message) => message.chatKey === chatKey)
    ) {
      void deliverOutgoing()
    }
  }, [
    chatKey,
    historyActiveStreamId,
    historyHoldsSteering,
    historyDeliveredAnEntry,
    deliverOutgoing,
    writeOutgoing,
  ])
  /* Nothing is out to come back withdrawn (a retry waiting on its delay), so nothing
     else would carry what a new chat holds past this unmount. */
  useEffect(
    () => () => {
      if (surfaceMountedRef.current) return
      const chatKey = chatKeyRef.current
      if (!chatKey.startsWith(PENDING_CHAT_KEY_PREFIX)) return
      const sendOut = outgoingRef.current.some(
        (message) =>
          message.chatKey === chatKey &&
          (message.status === 'sending' || message.status === 'steering')
      )
      if (!sendOut) handOffProvisionalOutgoing(chatKey)
    },
    [handOffProvisionalOutgoing]
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const retryOnline = () => {
      writeOutgoing((current) =>
        current.map((message) =>
          message.status === 'pending' ? { ...message, notBefore: undefined } : message
        )
      )
      void deliverOutgoing()
    }
    window.addEventListener('online', retryOnline)
    return () => window.removeEventListener('online', retryOnline)
  }, [deliverOutgoing, writeOutgoing])

  const stopGeneration = useCallback(async () => {
    if (pendingStopPromiseRef.current) return pendingStopPromiseRef.current

    let resolveStopOperation!: () => void
    let rejectStopOperation!: (error: unknown) => void
    const stopOperation = new Promise<void>((resolve, reject) => {
      resolveStopOperation = resolve
      rejectStopOperation = reject
    })
    stopOperation.catch(() => {})
    pendingStopPromiseRef.current = stopOperation

    const pendingAdmission = hasPendingChatAdmission() ? pendingChatAdmissionRef.current : null
    const wasSending = sendingRef.current || Boolean(pendingAdmission)
    let activeChatId = chatIdRef.current ?? selectedChatIdRef.current
    const sid =
      streamIdRef.current ||
      activeTurnRef.current?.userMessageId ||
      pendingAdmission?.userMessageId ||
      (activeChatId
        ? queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(activeChatId))
            ?.activeStreamId
        : undefined) ||
      undefined

    const activeAssistantMessageId =
      activeTurnRef.current?.assistantMessageId ??
      (sid ? getLiveAssistantMessageId(sid) : undefined)
    const initialStopRequestIdSnapshot = streamRequestIdRef.current
    const initialStopTraceparentSnapshot = streamTraceparentRef.current

    const stopNow = Date.now()
    const stopBlocksSnapshot = streamingBlocksRef.current.map((block) => ({
      ...block,
      ...(block.options ? { options: [...block.options] } : {}),
      ...(block.toolCall ? { toolCall: { ...block.toolCall } } : {}),
      ...(block.endedAt === undefined ? { endedAt: stopNow } : {}),
    }))
    const cachedAssistant = activeChatId
      ? queryClient
          .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(activeChatId))
          ?.messages.find((message) => message.id === activeAssistantMessageId)
      : undefined
    const stoppedToolCallIds = new Set(
      [...stopBlocksSnapshot, ...(cachedAssistant?.contentBlocks ?? [])].flatMap((block) =>
        block.toolCall ? [block.toolCall.id] : []
      )
    )
    const stopRequestIdSnapshot = streamRequestIdRef.current ?? initialStopRequestIdSnapshot
    const stopTraceparentSnapshot = streamTraceparentRef.current ?? initialStopTraceparentSnapshot
    /* Messages steered into this turn settle once the Stop does: those it applied
         stay where it applied them, the rest go out as the next turn. */
    appliedSteeringIds(stopBlocksSnapshot, appliedSteeringIdsSeen)
    appliedSteeringIds(cachedAssistant?.contentBlocks, appliedSteeringIdsSeen)
    if (sid) endedStreamIds.add(sid)

    locallyTerminalStreamIdRef.current = sid
    const stopActivityTracker =
      resourceActivityTrackerRef.current?.generation === streamGenRef.current
        ? resourceActivityTrackerRef.current
        : getResourceActivityTracker(streamGenRef.current, activeChatId)
    captureResourceActivityScope(stopActivityTracker, desktopScopeIdRef.current)
    if (chatIdRef.current) {
      captureResourceActivityScope(
        stopActivityTracker,
        desktopChatScopeId(scopeKey, chatIdRef.current)
      )
    }
    clearResourceActivity(stopActivityTracker, true)
    if (sid) stopDesktopTools(sid, USER_STOP_ABORT_REASON)

    // Establish the stream boundary immediately after synchronous activity
    // settlement. Native cancellation above is deliberately fire-and-forget,
    // so a slow shell cannot delay the server-side abort below.
    const stoppedGeneration = ++streamGenRef.current
    clearActiveTurn()
    streamReaderRef.current?.cancel().catch(() => {})
    streamReaderRef.current = null
    const stoppedController = abortControllerRef.current
    if (stoppedController !== pendingAdmission?.controller) {
      stoppedController?.abort(USER_STOP_ABORT_REASON)
    }
    abortControllerRef.current = null
    setTransportIdle()
    // The paced reveal may still hold up to a drain-horizon of buffered text;
    // after an explicit Stop it must not keep typing itself out.
    snapAllSmoothText()

    try {
      if (activeChatId) {
        await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(activeChatId) })
        upsertChatHistory(activeChatId, (current) => ({
          ...current,
          messages: current.messages.map((message) =>
            activeAssistantMessageId && message.id === activeAssistantMessageId
              ? markMessageStopped(message)
              : message
          ),
        }))
      } else {
        setPendingMessages((prev) =>
          prev.map((msg) => {
            const hasUnsettledTool = msg.contentBlocks?.some((block) =>
              isUnsettledToolState(block.toolCall?.status)
            )
            const hasOpenBlock = msg.contentBlocks?.some((block) => block.endedAt === undefined)
            if (!hasUnsettledTool && !hasOpenBlock) {
              return msg
            }
            const updatedBlocks: ContentBlock[] = (msg.contentBlocks ?? []).map((block) => ({
              ...block,
              ...(block.endedAt === undefined ? { endedAt: stopNow } : {}),
              ...(block.toolCall ? { toolCall: { ...block.toolCall } } : {}),
            }))
            finalizeResidualToolCalls(updatedBlocks, 'cancelled')
            updatedBlocks.push({ type: 'stopped' as const })
            return { ...msg, contentBlocks: updatedBlocks }
          })
        )
      }
    } catch (err) {
      if (sid && locallyTerminalStreamIdRef.current === sid) {
        locallyTerminalStreamIdRef.current = undefined
      }
      if (pendingStopPromiseRef.current === stopOperation) {
        pendingStopPromiseRef.current = null
      }
      setError(getErrorMessage(err, 'Failed to stop the previous response'))
      rejectStopOperation(err)
      deliverOutgoingRef.current()
      throw err
    }

    /** Exact tool ownership excludes other chats and independent manual workflow runs. */
    stopRunToolExecutions(stoppedToolCallIds)

    let abortSucceeded = false
    const stopBarrier = (async () => {
      try {
        let resolvedChatId = activeChatId ?? chatIdRef.current
        let abortSettled = false
        const postAbortRequest = async (chatId?: string): Promise<boolean> => {
          if (!sid) return true
          const payload = await requestJson(copilotChatAbortContract, {
            keepalive: true,
            signal: createTimeoutSignal(STOP_REQUEST_TIMEOUT_MS),
            headers: {
              ...(stopTraceparentSnapshot ? { traceparent: stopTraceparentSnapshot } : {}),
            },
            body: {
              streamId: sid,
              ...(organizationId ? { organizationId } : { workspaceId }),
              ...(chatId ? { chatId } : {}),
            },
          })
          abortSucceeded = true
          return payload.settled
        }
        let abortFailure: unknown
        const abortPromise = sid
          ? postAbortRequest(resolvedChatId).then(
              (settled) => {
                abortSettled = settled
              },
              (error) => {
                abortFailure = error
              }
            )
          : Promise.resolve()

        let stopFailure: unknown
        try {
          if (pendingAdmission && pendingAdmission.userMessageId === sid) {
            const admittedChatId = await pendingAdmission.settled
            resolvedChatId ??= admittedChatId
            pendingAdmission.controller.abort(USER_STOP_ABORT_REASON)
          }
          if (!resolvedChatId && sid) {
            resolvedChatId = await resolveChatIdForStream(sid, { preferExistingChatId: false })
          }
          if (resolvedChatId) {
            activeChatId = resolvedChatId
            if (
              streamGenRef.current === stoppedGeneration &&
              (!selectedChatIdRef.current || selectedChatIdRef.current === resolvedChatId)
            ) {
              adoptResolvedChatId(resolvedChatId, { replaceHomeHistory: true })
            }
          }

          if (wasSending && resolvedChatId) {
            await persistStoppedResponse({
              chatId: resolvedChatId,
              streamId: sid,
              requestId: stopRequestIdSnapshot,
              traceparent: stopTraceparentSnapshot,
            })
          }
        } catch (err) {
          stopFailure = err
        }

        await abortPromise
        if (sid && !abortSettled) {
          try {
            const retrySettled = await postAbortRequest(resolvedChatId)
            abortSettled = retrySettled
            abortFailure = retrySettled
              ? undefined
              : new Error('Previous response is still shutting down.')
          } catch (err) {
            abortFailure = err
          }
        }

        if (stopFailure || abortFailure) throw stopFailure ?? abortFailure
        if (wasSending && resolvedChatId) {
          activeChatId = resolvedChatId
        }
        if (streamGenRef.current === stoppedGeneration) {
          notifyTurnEnded({ error: false })
        }
      } finally {
        invalidateChatQueries({
          ...(activeChatId ? { targetChatId: activeChatId } : {}),
        })
        if (streamGenRef.current === stoppedGeneration) {
          resetEphemeralPreviewState({ removeStreamingResource: true })
        }
      }
    })()

    try {
      await withinDeadline(() => stopBarrier, Date.now() + STOP_REQUEST_TIMEOUT_MS)
      resolveStopOperation()
    } catch (err) {
      if (sid && !abortSucceeded && locallyTerminalStreamIdRef.current === sid) {
        locallyTerminalStreamIdRef.current = undefined
      }
      if (activeChatId) {
        invalidateChatQueries()
      }
      if (streamGenRef.current === stoppedGeneration) {
        setError(getErrorMessage(err, 'Failed to stop the previous response'))
      }
      rejectStopOperation(err)
      throw err
    } finally {
      if (pendingStopPromiseRef.current === stopOperation) {
        pendingStopPromiseRef.current = null
      }
      /** Whatever was sent while the Stop was out goes now, steered or as its own turn. */
      deliverOutgoingRef.current()
    }
  }, [
    cancelActiveBrowserTools,
    invalidateChatQueries,
    notifyTurnEnded,
    persistStoppedResponse,
    queryClient,
    resolveChatIdForStream,
    resetEphemeralPreviewState,
    upsertChatHistory,
    adoptResolvedChatId,
    clearResourceActivity,
    clearActiveTurn,
    getResourceActivityTracker,
    hasPendingChatAdmission,
    setTransportIdle,
    workspaceId,
    organizationId,
    appliedSteeringIdsSeen,
    endedStreamIds,
  ])

  useEffect(() => {
    return () => {
      cancelActiveStreamRecovery()
      if (outgoingRetryTimerRef.current) clearTimeout(outgoingRetryTimerRef.current)
      outgoingRetryTimerRef.current = null
      streamGenRef.current++
      cancelActiveStreamReader()
      abortControllerRef.current?.abort('unmount:client_cleanup')
      abortControllerRef.current = null
      for (const controller of detachedChatResolutionControllers) {
        controller.abort('unmount:detached_chat_resolution')
      }
      detachedChatResolutionControllers.clear()
      persistedTurnWaitRef.current?.controller.abort('unmount:persisted_turn_wait')
      completedTurnRef.current = null
      clearActiveTurn()
      sendingRef.current = false
    }
  }, [cancelActiveStreamRecovery, cancelActiveStreamReader, clearActiveTurn])

  return {
    messages,
    isChatHistoryPending,
    isSending,
    isReconnecting,
    error:
      error ?? (chatHistoryError ? 'Failed to load chat history. Refresh to try again.' : null),
    resolvedChatId,
    desktopScopeId,
    sendMessage,
    stopGeneration,
    resources,
    activeResourceId: effectiveActiveResourceId,
    setActiveResourceId,
    setTableViewContext,
    addResource,
    removeResource,
    reorderResources,
    retryMessage,
    dismissMessage,
    previewSession,
    getCurrentRequestId,
  }
}
