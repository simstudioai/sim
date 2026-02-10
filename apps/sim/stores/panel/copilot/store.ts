'use client'

import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import { applySseEvent, sseHandlers } from '@/lib/copilot/client-sse'
import {
  appendContinueOption,
  appendContinueOptionBlock,
  createErrorMessage,
  createStreamingMessage,
  createUserMessage,
  finalizeThinkingBlock,
  stripContinueOption,
  stripContinueOptionFromBlocks,
} from '@/lib/copilot/client-sse/content-blocks'
import { flushStreamingUpdates, stopStreamingUpdates } from '@/lib/copilot/client-sse/handlers'
import type { ClientContentBlock, ClientStreamingContext } from '@/lib/copilot/client-sse/types'
import {
  COPILOT_AUTO_ALLOWED_TOOLS_API_PATH,
  COPILOT_CHAT_API_PATH,
  COPILOT_CHAT_STREAM_API_PATH,
  COPILOT_CHECKPOINTS_API_PATH,
  COPILOT_CHECKPOINTS_REVERT_API_PATH,
  COPILOT_CONFIRM_API_PATH,
  COPILOT_CREDENTIALS_API_PATH,
  COPILOT_DELETE_CHAT_API_PATH,
  COPILOT_MODELS_API_PATH,
  MAX_RESUME_ATTEMPTS,
  OPTIMISTIC_TITLE_MAX_LENGTH,
  QUEUE_PROCESS_DELAY_MS,
  STREAM_STORAGE_KEY,
  STREAM_TIMEOUT_MS,
  SUBSCRIPTION_INVALIDATE_DELAY_MS,
} from '@/lib/copilot/constants'
import {
  buildCheckpointWorkflowState,
  buildToolCallsById,
  normalizeMessagesForUI,
  persistMessages,
  saveMessageCheckpoint,
} from '@/lib/copilot/messages'
import type { CopilotTransportMode } from '@/lib/copilot/models'
import { parseSSEStream } from '@/lib/copilot/orchestrator/sse-parser'
import {
  abortAllInProgressTools,
  cleanupActiveState,
  isRejectedState,
  resolveToolDisplay,
  stripTodoTags,
} from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { AvailableModel } from '@/lib/copilot/types'
import { getQueryClient } from '@/app/_shell/providers/query-provider'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import type {
  ChatContext,
  CheckpointEntry,
  CopilotMessage,
  CopilotStore,
  CopilotStreamInfo,
  CopilotToolCall,
  MessageFileAttachment,
} from '@/stores/panel/copilot/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotStore')

/**
 * Flag set on beforeunload to suppress continue option during page refresh/close.
 * Initialized once when the store module loads.
 */
let _isPageUnloading = false
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    _isPageUnloading = true
  })
}
function isPageUnloading(): boolean {
  return _isPageUnloading
}

function readActiveStreamFromStorage(): CopilotStreamInfo | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STREAM_STORAGE_KEY)
    logger.debug('[Copilot] Reading stream from storage', {
      hasRaw: !!raw,
      rawPreview: raw ? raw.substring(0, 100) : null,
    })
    if (!raw) return null
    const parsed = JSON.parse(raw) as CopilotStreamInfo
    return parsed?.streamId ? parsed : null
  } catch (e) {
    logger.warn('[Copilot] Failed to read stream from storage', { error: String(e) })
    return null
  }
}

function writeActiveStreamToStorage(info: CopilotStreamInfo | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!info) {
      logger.debug('[Copilot] Clearing stream from storage', {
        isPageUnloading: isPageUnloading(),
        stack: new Error().stack?.split('\n').slice(1, 4).join(' <- '),
      })
      window.sessionStorage.removeItem(STREAM_STORAGE_KEY)
      return
    }
    const payload = JSON.stringify(info)
    window.sessionStorage.setItem(STREAM_STORAGE_KEY, payload)
    const verified = window.sessionStorage.getItem(STREAM_STORAGE_KEY) === payload
    logger.debug('[Copilot] Writing stream to storage', {
      streamId: info.streamId,
      lastEventId: info.lastEventId,
      userMessageContent: info.userMessageContent?.slice(0, 30),
      verified,
    })
  } catch (e) {
    logger.error('[Copilot] Failed to write stream to storage', { error: String(e) })
  }
}

function updateActiveStreamEventId(
  get: () => CopilotStore,
  set: (next: Partial<CopilotStore>) => void,
  streamId: string,
  eventId: number
): void {
  const current = get().activeStream
  if (!current || current.streamId !== streamId) return
  if (eventId <= (current.lastEventId || 0)) return
  const next = { ...current, lastEventId: eventId }
  set({ activeStream: next })
  writeActiveStreamToStorage(next)
}

const AUTO_ALLOWED_TOOLS_STORAGE_KEY = 'copilot_auto_allowed_tools'

function readAutoAllowedToolsFromStorage(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AUTO_ALLOWED_TOOLS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch (error) {
    logger.warn('[AutoAllowedTools] Failed to read local cache', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function writeAutoAllowedToolsToStorage(tools: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTO_ALLOWED_TOOLS_STORAGE_KEY, JSON.stringify(tools))
  } catch (error) {
    logger.warn('[AutoAllowedTools] Failed to write local cache', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function isToolAutoAllowedByList(toolId: string, autoAllowedTools: string[]): boolean {
  if (!toolId) return false
  const normalizedTarget = toolId.trim()
  return autoAllowedTools.some((allowed) => allowed?.trim() === normalizedTarget)
}

/**
 * Clear any lingering diff preview from a previous session.
 * Called lazily when the store is first activated (setWorkflowId).
 */
let _initialDiffCleared = false
function clearInitialDiffIfNeeded(): void {
  if (_initialDiffCleared) return
  _initialDiffCleared = true
  try {
    const diffStore = useWorkflowDiffStore.getState()
    if (diffStore?.hasActiveDiff) {
      diffStore.clearDiff()
    }
  } catch (error) {
    logger.warn('[Copilot] Failed to clear initial diff state', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const TEXT_BLOCK_TYPE = 'text'
const CONTINUE_OPTIONS_TAG = '<options>{"1":"Continue"}</options>'

function cloneContentBlocks(blocks: ClientContentBlock[]): ClientContentBlock[] {
  if (!Array.isArray(blocks)) return []
  return blocks.map((block) => (block ? { ...block } : block))
}

function extractTextFromBlocks(blocks: ClientContentBlock[]): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === TEXT_BLOCK_TYPE && typeof block.content === 'string')
    .map((block) => block.content)
    .join('')
}

function appendTextToBlocks(blocks: ClientContentBlock[], text: string): ClientContentBlock[] {
  const nextBlocks = cloneContentBlocks(blocks)
  if (!text) return nextBlocks
  const lastIndex = nextBlocks.length - 1
  const lastBlock = nextBlocks[lastIndex]
  if (lastBlock?.type === TEXT_BLOCK_TYPE) {
    const current = typeof lastBlock.content === 'string' ? lastBlock.content : ''
    nextBlocks[lastIndex] = { ...lastBlock, content: current + text }
    return nextBlocks
  }
  nextBlocks.push({ type: TEXT_BLOCK_TYPE, content: text, timestamp: Date.now() })
  return nextBlocks
}

function findLastTextBlock(blocks: ClientContentBlock[]): ClientContentBlock | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  const lastBlock = blocks[blocks.length - 1]
  return lastBlock?.type === TEXT_BLOCK_TYPE ? lastBlock : null
}

function replaceTextBlocks(blocks: ClientContentBlock[], text: string): ClientContentBlock[] {
  const next: ClientContentBlock[] = []
  let inserted = false
  for (const block of blocks ?? []) {
    if (block?.type === TEXT_BLOCK_TYPE) {
      if (!inserted && text) {
        next.push({ type: TEXT_BLOCK_TYPE, content: text, timestamp: Date.now() })
        inserted = true
      }
      continue
    }
    next.push(block ? { ...block } : block)
  }
  if (!inserted && text) {
    next.push({ type: TEXT_BLOCK_TYPE, content: text, timestamp: Date.now() })
  }
  return next
}

function createClientStreamingContext(messageId: string): ClientStreamingContext {
  return {
    messageId,
    accumulatedContent: '',
    contentBlocks: [],
    currentTextBlock: null,
    isInThinkingBlock: false,
    currentThinkingBlock: null,
    isInDesignWorkflowBlock: false,
    designWorkflowContent: '',
    pendingContent: '',
    doneEventCount: 0,
    subAgentContent: {},
    subAgentToolCalls: {},
    subAgentBlocks: {},
  }
}

type CopilotSet = (
  partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)
) => void

type CopilotGet = () => CopilotStore

interface SendMessageOptionsInput {
  stream?: boolean
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  messageId?: string
  queueIfBusy?: boolean
}

interface PreparedSendContext {
  workflowId: string
  currentChat: CopilotChat | null
  mode: CopilotStore['mode']
  message: string
  stream: boolean
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  userMessage: CopilotMessage
  streamingMessage: CopilotMessage
  nextAbortController: AbortController
}

type InitiateStreamResult =
  | { kind: 'success'; result: Awaited<ReturnType<typeof sendStreamingMessage>> }
  | { kind: 'error'; error: unknown }

/**
 * Parse a composite model key (e.g. "bedrock/claude-opus-4-6") into provider and raw model ID.
 * This mirrors the agent block pattern in providers/models.ts where model IDs are prefixed
 * with the provider (e.g. "azure-anthropic/claude-sonnet-4-5", "bedrock/claude-opus-4-6").
 */
function parseModelKey(compositeKey: string): { provider: string; modelId: string } {
  const slashIdx = compositeKey.indexOf('/')
  if (slashIdx === -1) return { provider: '', modelId: compositeKey }
  return { provider: compositeKey.slice(0, slashIdx), modelId: compositeKey.slice(slashIdx + 1) }
}

/** Look up the provider for the currently selected model from the composite key. */
function getSelectedProvider(get: CopilotGet): string | undefined {
  const { provider } = parseModelKey(get().selectedModel)
  return provider || undefined
}

function prepareSendContext(
  get: CopilotGet,
  set: CopilotSet,
  message: string,
  options: SendMessageOptionsInput
): PreparedSendContext | null {
  const {
    workflowId,
    currentChat,
    mode,
    revertState,
    isSendingMessage,
    abortController: activeAbortController,
  } = get()
  const { stream = true, fileAttachments, contexts, messageId, queueIfBusy = true } = options

  if (!workflowId) return null

  if (isSendingMessage && !activeAbortController) {
    logger.warn('[Copilot] sendMessage: stale sending state detected, clearing', {
      originalMessageId: messageId,
    })
    set({ isSendingMessage: false })
  } else if (isSendingMessage && activeAbortController?.signal.aborted) {
    logger.warn('[Copilot] sendMessage: aborted controller detected, clearing', {
      originalMessageId: messageId,
    })
    set({ isSendingMessage: false, abortController: null })
  } else if (isSendingMessage) {
    if (queueIfBusy) {
      get().addToQueue(message, { fileAttachments, contexts, messageId })
      logger.info('[Copilot] Message queued (already sending)', {
        queueLength: get().messageQueue.length + 1,
        originalMessageId: messageId,
      })
      return null
    }
    get().abortMessage({ suppressContinueOption: true })
  }

  const nextAbortController = new AbortController()
  set({ isSendingMessage: true, error: null, abortController: nextAbortController })

  const userMessage = createUserMessage(message, fileAttachments, contexts, messageId)
  const streamingMessage = createStreamingMessage()
  const snapshot = workflowId ? buildCheckpointWorkflowState(workflowId) : null
  if (snapshot) {
    set((state) => ({
      messageSnapshots: { ...state.messageSnapshots, [userMessage.id]: snapshot },
    }))
  }

  get()
    .loadSensitiveCredentialIds()
    .catch((err) => {
      logger.warn('[Copilot] Failed to load sensitive credential IDs', err)
    })
  get()
    .loadAutoAllowedTools()
    .catch((err) => {
      logger.warn('[Copilot] Failed to load auto-allowed tools', err)
    })

  let newMessages: CopilotMessage[]
  if (revertState) {
    const currentMessages = get().messages
    newMessages = [...currentMessages, userMessage, streamingMessage]
    set({ revertState: null, inputValue: '' })
  } else {
    const currentMessages = get().messages
    const existingIndex = messageId ? currentMessages.findIndex((m) => m.id === messageId) : -1
    if (existingIndex !== -1) {
      newMessages = [...currentMessages.slice(0, existingIndex), userMessage, streamingMessage]
    } else {
      newMessages = [...currentMessages, userMessage, streamingMessage]
    }
  }

  const isFirstMessage = get().messages.length === 0 && !currentChat?.title
  set({
    messages: newMessages,
    currentUserMessageId: userMessage.id,
  })

  const activeStream: CopilotStreamInfo = {
    streamId: userMessage.id,
    workflowId,
    chatId: currentChat?.id,
    userMessageId: userMessage.id,
    assistantMessageId: streamingMessage.id,
    lastEventId: 0,
    resumeAttempts: 0,
    userMessageContent: message,
    fileAttachments,
    contexts,
    startedAt: Date.now(),
  }
  logger.info('[Copilot] Creating new active stream', {
    streamId: activeStream.streamId,
    workflowId: activeStream.workflowId,
    chatId: activeStream.chatId,
    userMessageContent: message.slice(0, 50),
  })
  set({ activeStream })
  writeActiveStreamToStorage(activeStream)

  if (isFirstMessage) {
    const optimisticTitle =
      message.length > OPTIMISTIC_TITLE_MAX_LENGTH
        ? `${message.substring(0, OPTIMISTIC_TITLE_MAX_LENGTH - 3)}...`
        : message
    set((state) => ({
      currentChat: state.currentChat
        ? { ...state.currentChat, title: optimisticTitle }
        : state.currentChat,
      chats: state.currentChat
        ? state.chats.map((c) =>
            c.id === state.currentChat!.id ? { ...c, title: optimisticTitle } : c
          )
        : state.chats,
    }))
  }

  return {
    workflowId,
    currentChat,
    mode,
    message,
    stream,
    fileAttachments,
    contexts,
    userMessage,
    streamingMessage,
    nextAbortController,
  }
}

async function initiateStream(
  prepared: PreparedSendContext,
  get: CopilotGet
): Promise<InitiateStreamResult> {
  try {
    const { contexts, mode } = prepared
    logger.debug('sendMessage: preparing request', {
      hasContexts: Array.isArray(contexts),
      contextsCount: Array.isArray(contexts) ? contexts.length : 0,
      contextsPreview: Array.isArray(contexts)
        ? contexts.map((c) => ({
            kind: c?.kind,
            chatId: c?.kind === 'past_chat' ? c.chatId : undefined,
            workflowId:
              c?.kind === 'workflow' ||
              c?.kind === 'current_workflow' ||
              c?.kind === 'workflow_block'
                ? c.workflowId
                : undefined,
            label: c?.label,
          }))
        : undefined,
    })

    const { streamingPlanContent } = get()
    let messageToSend = prepared.message
    if (streamingPlanContent?.trim()) {
      messageToSend = `Design Document:\n\n${streamingPlanContent}\n\n==============\n\nUser Query:\n\n${prepared.message}`
      logger.debug('[DesignDocument] Prepending plan content to message', {
        planLength: streamingPlanContent.length,
        originalMessageLength: prepared.message.length,
        finalMessageLength: messageToSend.length,
      })
    }

    const apiMode: CopilotTransportMode =
      mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : 'agent'
    const uiToApiCommandMap: Record<string, string> = { actions: 'superagent' }
    const commands = contexts
      ?.filter((c) => c.kind === 'slash_command' && 'command' in c)
      .map((c) => {
        const uiCommand = c.command.toLowerCase()
        return uiToApiCommandMap[uiCommand] || uiCommand
      }) as string[] | undefined
    const filteredContexts = contexts?.filter((c) => c.kind !== 'slash_command')

    const { provider: selectedProvider, modelId: selectedModelId } = parseModelKey(
      get().selectedModel
    )
    const result = await sendStreamingMessage({
      message: messageToSend,
      userMessageId: prepared.userMessage.id,
      chatId: prepared.currentChat?.id,
      workflowId: prepared.workflowId || undefined,
      mode: apiMode,
      model: selectedModelId,
      provider: selectedProvider || undefined,
      prefetch: get().agentPrefetch,
      createNewChat: !prepared.currentChat,
      stream: prepared.stream,
      fileAttachments: prepared.fileAttachments,
      contexts: filteredContexts,
      commands: commands?.length ? commands : undefined,
      abortSignal: prepared.nextAbortController.signal,
    })

    return { kind: 'success', result }
  } catch (error) {
    return { kind: 'error', error }
  }
}

async function processStreamEvents(
  initiated: InitiateStreamResult,
  prepared: PreparedSendContext,
  get: CopilotGet
): Promise<boolean> {
  if (initiated.kind !== 'success') return false
  if (!initiated.result.success || !initiated.result.stream) return false
  await get().handleStreamingResponse(
    initiated.result.stream,
    prepared.streamingMessage.id,
    false,
    prepared.userMessage.id,
    prepared.nextAbortController.signal
  )
  return true
}

async function finalizeStream(
  initiated: InitiateStreamResult,
  processed: boolean,
  prepared: PreparedSendContext,
  set: CopilotSet
): Promise<void> {
  if (processed) {
    set({ chatsLastLoadedAt: null, chatsLoadedForWorkflow: null })
    return
  }

  if (initiated.kind === 'success') {
    const { result } = initiated
    if (result.error === 'Request was aborted') {
      return
    }

    let errorContent = result.error || 'Failed to send message'
    let errorType:
      | 'usage_limit'
      | 'unauthorized'
      | 'forbidden'
      | 'rate_limit'
      | 'upgrade_required'
      | undefined
    if (result.status === 401) {
      errorContent =
        '_Unauthorized request. You need a valid API key to use the copilot. You can get one by going to [sim.ai](https://sim.ai) settings and generating one there._'
      errorType = 'unauthorized'
    } else if (result.status === 402) {
      errorContent =
        '_Usage limit exceeded. To continue using this service, upgrade your plan or increase your usage limit to:_'
      errorType = 'usage_limit'
    } else if (result.status === 403) {
      errorContent =
        '_Access denied by the Copilot backend. Please verify your API key and server configuration._'
      errorType = 'forbidden'
    } else if (result.status === 426) {
      errorContent =
        '_Please upgrade to the latest version of the Sim platform to continue using the copilot._'
      errorType = 'upgrade_required'
    } else if (result.status === 429) {
      errorContent = '_Provider rate limit exceeded. Please try again later._'
      errorType = 'rate_limit'
    }

    const errorMessage = createErrorMessage(prepared.streamingMessage.id, errorContent, errorType)
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === prepared.streamingMessage.id ? errorMessage : m
      ),
      error: errorContent,
      isSendingMessage: false,
      abortController: null,
    }))
    set({ activeStream: null })
    writeActiveStreamToStorage(null)
    return
  }

  const error = initiated.error
  if (error instanceof Error && error.name === 'AbortError') return
  const errorMessage = createErrorMessage(
    prepared.streamingMessage.id,
    'Sorry, I encountered an error while processing your message. Please try again.'
  )
  set((state) => ({
    messages: state.messages.map((m) => (m.id === prepared.streamingMessage.id ? errorMessage : m)),
    error: error instanceof Error ? error.message : 'Failed to send message',
    isSendingMessage: false,
    abortController: null,
  }))
  set({ activeStream: null })
  writeActiveStreamToStorage(null)
}

interface ResumeValidationResult {
  nextStream: CopilotStreamInfo
  messages: CopilotMessage[]
  isFreshResume: boolean
}

async function validateResumeState(
  get: CopilotGet,
  set: CopilotSet
): Promise<ResumeValidationResult | null> {
  const inMemoryStream = get().activeStream
  const storedStream = readActiveStreamFromStorage()
  const stored = inMemoryStream || storedStream
  logger.debug('[Copilot] Resume check', {
    hasInMemory: !!inMemoryStream,
    hasStored: !!storedStream,
    usingStream: inMemoryStream ? 'memory' : storedStream ? 'storage' : 'none',
    streamId: stored?.streamId,
    lastEventId: stored?.lastEventId,
    storedWorkflowId: stored?.workflowId,
    storedChatId: stored?.chatId,
    userMessageContent: stored?.userMessageContent?.slice(0, 50),
    currentWorkflowId: get().workflowId,
    isSendingMessage: get().isSendingMessage,
    resumeAttempts: stored?.resumeAttempts,
  })

  if (!stored || !stored.streamId) return null
  if (get().isSendingMessage) return null
  if (get().workflowId && stored.workflowId !== get().workflowId) return null

  if (stored.resumeAttempts >= MAX_RESUME_ATTEMPTS) {
    logger.warn('[Copilot] Too many resume attempts, giving up')
    return null
  }

  const nextStream: CopilotStreamInfo = {
    ...stored,
    resumeAttempts: (stored.resumeAttempts || 0) + 1,
  }
  set({ activeStream: nextStream })
  writeActiveStreamToStorage(nextStream)

  let messages = get().messages
  const isFreshResume = messages.length === 0
  if (isFreshResume && nextStream.chatId) {
    try {
      logger.debug('[Copilot] Loading chat for resume', { chatId: nextStream.chatId })
      const response = await fetch(`${COPILOT_CHAT_API_PATH}?chatId=${nextStream.chatId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.chat) {
          const normalizedMessages = normalizeMessagesForUI(data.chat.messages ?? [])
          const toolCallsById = buildToolCallsById(normalizedMessages)
          set({
            currentChat: data.chat,
            messages: normalizedMessages,
            toolCallsById,
            streamingPlanContent: data.chat.planArtifact || '',
          })
          messages = normalizedMessages
          logger.debug('[Copilot] Loaded chat for resume', {
            chatId: nextStream.chatId,
            messageCount: normalizedMessages.length,
          })
        }
      }
    } catch (e) {
      logger.warn('[Copilot] Failed to load chat for resume', { error: String(e) })
    }
  }

  return { nextStream, messages, isFreshResume }
}

interface ReplayBufferedEventsResult {
  nextStream: CopilotStreamInfo
  bufferedContent: string
  replayBlocks: ClientContentBlock[] | null
  resumeFromEventId: number
}

async function replayBufferedEvents(
  stream: CopilotStreamInfo,
  get: CopilotGet,
  set: CopilotSet
): Promise<ReplayBufferedEventsResult> {
  let nextStream = stream
  let bufferedContent = ''
  let replayBlocks: ClientContentBlock[] | null = null
  let resumeFromEventId = nextStream.lastEventId

  if (nextStream.lastEventId > 0) {
    try {
      logger.debug('[Copilot] Fetching all buffered events', {
        streamId: nextStream.streamId,
        savedLastEventId: nextStream.lastEventId,
      })
      const batchUrl = `${COPILOT_CHAT_STREAM_API_PATH}?streamId=${encodeURIComponent(
        nextStream.streamId
      )}&from=0&to=${encodeURIComponent(String(nextStream.lastEventId))}&batch=true`
      const batchResponse = await fetch(batchUrl, { credentials: 'include' })
      if (batchResponse.ok) {
        const batchData = await batchResponse.json()
        if (batchData.success && Array.isArray(batchData.events)) {
          const replayContext = createClientStreamingContext(nextStream.assistantMessageId)
          replayContext.suppressStreamingUpdates = true
          for (const entry of batchData.events) {
            const event = entry.event
            if (event) {
              await applySseEvent(event, replayContext, get, set)
            }
            if (typeof entry.eventId === 'number' && entry.eventId > resumeFromEventId) {
              resumeFromEventId = entry.eventId
            }
          }
          bufferedContent = replayContext.accumulatedContent
          replayBlocks = replayContext.contentBlocks
          logger.debug('[Copilot] Loaded buffered content instantly', {
            eventCount: batchData.events.length,
            contentLength: bufferedContent.length,
            resumeFromEventId,
          })
        } else {
          logger.warn('[Copilot] Batch response missing events', {
            success: batchData.success,
            hasEvents: Array.isArray(batchData.events),
          })
        }
      } else {
        logger.warn('[Copilot] Failed to fetch buffered events', {
          status: batchResponse.status,
        })
      }
    } catch (e) {
      logger.warn('[Copilot] Failed to fetch buffered events', { error: String(e) })
    }
  }

  if (resumeFromEventId > nextStream.lastEventId) {
    nextStream = { ...nextStream, lastEventId: resumeFromEventId }
    set({ activeStream: nextStream })
    writeActiveStreamToStorage(nextStream)
  }

  return { nextStream, bufferedContent, replayBlocks, resumeFromEventId }
}

interface ResumeFinalizeResult {
  nextStream: CopilotStreamInfo
  bufferedContent: string
  resumeFromEventId: number
}

function finalizeResume(
  messages: CopilotMessage[],
  replay: ReplayBufferedEventsResult,
  get: CopilotGet,
  set: CopilotSet
): ResumeFinalizeResult {
  let nextMessages = messages
  let cleanedExisting = false

  nextMessages = nextMessages.map((m) => {
    if (m.id !== replay.nextStream.assistantMessageId) return m
    const hasContinueTag =
      (typeof m.content === 'string' && m.content.includes(CONTINUE_OPTIONS_TAG)) ||
      (Array.isArray(m.contentBlocks) &&
        m.contentBlocks.some((b) => b.type === 'text' && b.content?.includes(CONTINUE_OPTIONS_TAG)))
    if (!hasContinueTag) return m
    cleanedExisting = true
    return {
      ...m,
      content: stripContinueOption(m.content || ''),
      contentBlocks: stripContinueOptionFromBlocks(m.contentBlocks ?? []),
    }
  })

  if (!messages.some((m) => m.id === replay.nextStream.userMessageId)) {
    const userMessage = createUserMessage(
      replay.nextStream.userMessageContent || '',
      replay.nextStream.fileAttachments,
      replay.nextStream.contexts,
      replay.nextStream.userMessageId
    )
    nextMessages = [...nextMessages, userMessage]
  }

  if (!nextMessages.some((m) => m.id === replay.nextStream.assistantMessageId)) {
    const assistantMessage: CopilotMessage = {
      ...createStreamingMessage(),
      id: replay.nextStream.assistantMessageId,
      content: replay.bufferedContent,
      contentBlocks:
        replay.replayBlocks && replay.replayBlocks.length > 0
          ? replay.replayBlocks
          : replay.bufferedContent
            ? [{ type: TEXT_BLOCK_TYPE, content: replay.bufferedContent, timestamp: Date.now() }]
            : [],
    }
    nextMessages = [...nextMessages, assistantMessage]
  } else if (replay.bufferedContent || (replay.replayBlocks && replay.replayBlocks.length > 0)) {
    nextMessages = nextMessages.map((m) => {
      if (m.id !== replay.nextStream.assistantMessageId) return m
      let nextBlocks =
        replay.replayBlocks && replay.replayBlocks.length > 0 ? replay.replayBlocks : null
      if (!nextBlocks) {
        const existingBlocks = Array.isArray(m.contentBlocks) ? m.contentBlocks : []
        const existingText = extractTextFromBlocks(existingBlocks)
        if (existingText && replay.bufferedContent.startsWith(existingText)) {
          const delta = replay.bufferedContent.slice(existingText.length)
          nextBlocks = delta
            ? appendTextToBlocks(existingBlocks, delta)
            : cloneContentBlocks(existingBlocks)
        } else if (!existingText && existingBlocks.length === 0) {
          nextBlocks = replay.bufferedContent
            ? [{ type: TEXT_BLOCK_TYPE, content: replay.bufferedContent, timestamp: Date.now() }]
            : []
        } else {
          nextBlocks = replaceTextBlocks(existingBlocks, replay.bufferedContent)
        }
      }
      return {
        ...m,
        content: replay.bufferedContent,
        contentBlocks: nextBlocks ?? [],
      }
    })
  }

  if (cleanedExisting || nextMessages !== messages || replay.bufferedContent) {
    set({ messages: nextMessages, currentUserMessageId: replay.nextStream.userMessageId })
  } else {
    set({ currentUserMessageId: replay.nextStream.userMessageId })
  }

  return {
    nextStream: replay.nextStream,
    bufferedContent: replay.bufferedContent,
    resumeFromEventId: replay.resumeFromEventId,
  }
}

async function resumeFromLiveStream(
  resume: ResumeFinalizeResult,
  isFreshResume: boolean,
  get: CopilotGet,
  set: CopilotSet
): Promise<boolean> {
  const abortController = new AbortController()
  set({ isSendingMessage: true, abortController })

  try {
    logger.debug('[Copilot] Attempting to resume stream', {
      streamId: resume.nextStream.streamId,
      savedLastEventId: resume.nextStream.lastEventId,
      resumeFromEventId: resume.resumeFromEventId,
      isFreshResume,
      bufferedContentLength: resume.bufferedContent.length,
      assistantMessageId: resume.nextStream.assistantMessageId,
      chatId: resume.nextStream.chatId,
    })
    const { provider: resumeProvider, modelId: resumeModelId } = parseModelKey(get().selectedModel)
    const result = await sendStreamingMessage({
      message: resume.nextStream.userMessageContent || '',
      userMessageId: resume.nextStream.userMessageId,
      workflowId: resume.nextStream.workflowId,
      chatId: resume.nextStream.chatId || get().currentChat?.id || undefined,
      mode: get().mode === 'ask' ? 'ask' : get().mode === 'plan' ? 'plan' : 'agent',
      model: resumeModelId,
      provider: resumeProvider || undefined,
      prefetch: get().agentPrefetch,
      stream: true,
      resumeFromEventId: resume.resumeFromEventId,
      abortSignal: abortController.signal,
    })

    logger.info('[Copilot] Resume stream result', {
      success: result.success,
      hasStream: !!result.stream,
      error: result.error,
    })

    if (result.success && result.stream) {
      await get().handleStreamingResponse(
        result.stream,
        resume.nextStream.assistantMessageId,
        true,
        resume.nextStream.userMessageId,
        abortController.signal
      )
      return true
    }

    set({ isSendingMessage: false, abortController: null })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('aborted'))
    ) {
      logger.info('[Copilot] Resume stream aborted by user')
      set({ isSendingMessage: false, abortController: null })
      return false
    }
    logger.error('[Copilot] Failed to resume stream', {
      error: error instanceof Error ? error.message : String(error),
    })
    set({ isSendingMessage: false, abortController: null })
  }
  return false
}

const cachedAutoAllowedTools = readAutoAllowedToolsFromStorage()

// Initial state (subset required for UI/streaming)
const initialState = {
  mode: 'build' as const,
  selectedModel: 'anthropic/claude-opus-4-6' as CopilotStore['selectedModel'],
  agentPrefetch: false,
  availableModels: [] as AvailableModel[],
  isLoadingModels: false,
  isCollapsed: false,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  messageCheckpoints: {} as Record<string, CheckpointEntry[]>,
  messageSnapshots: {} as Record<string, WorkflowState>,
  isLoading: false,
  isLoadingChats: false,
  isLoadingCheckpoints: false,
  isSendingMessage: false,
  isSaving: false,
  isRevertingCheckpoint: false,
  isAborting: false,
  error: null as string | null,
  saveError: null as string | null,
  checkpointError: null as string | null,
  workflowId: null as string | null,
  abortController: null as AbortController | null,
  chatsLastLoadedAt: null as Date | null,
  chatsLoadedForWorkflow: null as string | null,
  revertState: null as { messageId: string; messageContent: string } | null,
  inputValue: '',
  planTodos: [] as Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>,
  showPlanTodos: false,
  streamingPlanContent: '',
  toolCallsById: {} as Record<string, CopilotToolCall>,
  suppressAutoSelect: false,
  autoAllowedTools: cachedAutoAllowedTools ?? ([] as string[]),
  autoAllowedToolsLoaded: cachedAutoAllowedTools !== null,
  activeStream: null as CopilotStreamInfo | null,
  messageQueue: [] as import('./types').QueuedMessage[],
  suppressAbortContinueOption: false,
  sensitiveCredentialIds: new Set<string>(),
}

export const useCopilotStore = create<CopilotStore>()(
  devtools((set, get) => ({
    ...initialState,

    // Basic mode controls
    setMode: (mode) => set({ mode }),

    // Clear messages (don't clear streamingPlanContent - let it persist)
    clearMessages: () => set({ messages: [] }),

    // Workflow selection
    setWorkflowId: async (workflowId: string | null) => {
      clearInitialDiffIfNeeded()
      const currentWorkflowId = get().workflowId
      if (currentWorkflowId === workflowId) return
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort all in-progress tools and clear any diff preview
      cleanupActiveState(
        set as unknown as (partial: Record<string, unknown>) => void,
        get as unknown as () => Record<string, unknown>
      )

      set({
        ...initialState,
        workflowId,
        mode: get().mode,
        selectedModel: get().selectedModel,
        agentPrefetch: get().agentPrefetch,
        availableModels: get().availableModels,
        isLoadingModels: get().isLoadingModels,
        autoAllowedTools: get().autoAllowedTools,
        autoAllowedToolsLoaded: get().autoAllowedToolsLoaded,
      })
    },

    // Chats (minimal implementation for visibility)
    validateCurrentChat: () => {
      const { currentChat, workflowId, chats } = get()
      if (!currentChat || !workflowId) return false
      const chatExists = chats.some((c) => c.id === currentChat.id)
      if (!chatExists) {
        set({ currentChat: null, messages: [] })
        return false
      }
      return true
    },

    selectChat: async (chat: CopilotChat) => {
      const { isSendingMessage, currentChat, workflowId } = get()
      if (!workflowId) {
        return
      }
      if (currentChat && currentChat.id !== chat.id && isSendingMessage) get().abortMessage()

      // Abort in-progress tools and clear diff when changing chats
      cleanupActiveState(
        set as unknown as (partial: Record<string, unknown>) => void,
        get as unknown as () => Record<string, unknown>
      )

      // Restore plan content and config (mode/model) from selected chat
      const planArtifact = chat.planArtifact || ''
      const chatConfig = chat.config ?? {}
      const chatMode = chatConfig.mode || get().mode
      const chatModel = chatConfig.model || get().selectedModel

      logger.debug('[Chat] Restoring chat config', {
        chatId: chat.id,
        mode: chatMode,
        model: chatModel,
        hasPlanArtifact: !!planArtifact,
      })

      // Capture previous chat/messages for optimistic background save
      const previousChat = currentChat
      const previousMessages = get().messages
      const previousMode = get().mode
      const previousModel = get().selectedModel

      // Optimistically set selected chat and normalize messages for UI
      const normalizedMessages = normalizeMessagesForUI(chat.messages ?? [])
      const toolCallsById = buildToolCallsById(normalizedMessages)

      set({
        currentChat: chat,
        messages: normalizedMessages,
        toolCallsById,
        planTodos: [],
        showPlanTodos: false,
        streamingPlanContent: planArtifact,
        mode: chatMode,
        selectedModel: chatModel as CopilotStore['selectedModel'],
        suppressAutoSelect: false,
      })

      // Background-save the previous chat's latest messages, plan artifact, and config before switching (optimistic)
      try {
        if (previousChat && previousChat.id !== chat.id) {
          const previousPlanArtifact = get().streamingPlanContent
          void persistMessages({
            chatId: previousChat.id,
            messages: previousMessages,
            sensitiveCredentialIds: get().sensitiveCredentialIds,
            planArtifact: previousPlanArtifact || null,
            mode: previousMode,
            model: previousModel,
          })
        }
      } catch (error) {
        logger.warn('[Copilot] Failed to schedule previous-chat background save', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Refresh selected chat from server to ensure we have latest messages/tool calls
      try {
        const response = await fetch(`${COPILOT_CHAT_API_PATH}?workflowId=${workflowId}`)
        if (!response.ok) throw new Error(`Failed to fetch latest chat data: ${response.status}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const latestChat = data.chats.find((c: CopilotChat) => c.id === chat.id)
          if (latestChat) {
            const normalizedMessages = normalizeMessagesForUI(latestChat.messages ?? [])
            const toolCallsById = buildToolCallsById(normalizedMessages)

            set({
              currentChat: latestChat,
              messages: normalizedMessages,
              chats: (get().chats ?? []).map((c: CopilotChat) =>
                c.id === chat.id ? latestChat : c
              ),
              toolCallsById,
            })
            try {
              await get().loadMessageCheckpoints(latestChat.id)
            } catch (error) {
              logger.warn('[Copilot] Failed loading checkpoints for selected chat', {
                chatId: latestChat.id,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      } catch (error) {
        logger.warn('[Copilot] Failed to refresh selected chat from server', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    createNewChat: async () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort in-progress tools and clear diff on new chat
      cleanupActiveState(
        set as unknown as (partial: Record<string, unknown>) => void,
        get as unknown as () => Record<string, unknown>
      )

      // Background-save the current chat before clearing (optimistic)
      try {
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          const currentMessages = get().messages
          void persistMessages({
            chatId: currentChat.id,
            messages: currentMessages,
            sensitiveCredentialIds: get().sensitiveCredentialIds,
            planArtifact: streamingPlanContent || null,
            mode,
            model: selectedModel,
          })
        }
      } catch (error) {
        logger.warn('[Copilot] Failed to schedule current-chat background save', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      set({
        currentChat: null,
        messages: [],
        messageCheckpoints: {},
        planTodos: [],
        showPlanTodos: false,
        streamingPlanContent: '',
        suppressAutoSelect: true,
      })
    },

    deleteChat: async (chatId: string) => {
      try {
        // Call delete API
        const response = await fetch(COPILOT_DELETE_CHAT_API_PATH, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId }),
        })

        if (!response.ok) {
          throw new Error(`Failed to delete chat: ${response.status}`)
        }

        // Remove from local state
        set((state) => ({
          chats: state.chats.filter((c) => c.id !== chatId),
          // If deleted chat was current, clear it
          currentChat: state.currentChat?.id === chatId ? null : state.currentChat,
          messages: state.currentChat?.id === chatId ? [] : state.messages,
        }))

        logger.info('Chat deleted', { chatId })
      } catch (error) {
        logger.error('Failed to delete chat:', error)
        throw error
      }
    },

    loadChats: async (_forceRefresh = false) => {
      const { workflowId } = get()

      if (!workflowId) {
        set({ chats: [], isLoadingChats: false })
        return
      }

      // For now always fetch fresh
      set({ isLoadingChats: true })
      try {
        const url = `${COPILOT_CHAT_API_PATH}?workflowId=${workflowId}`
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to fetch chats: ${response.status}`)
        }
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const now = new Date()
          set({
            chats: data.chats,
            isLoadingChats: false,
            chatsLastLoadedAt: now,
            chatsLoadedForWorkflow: workflowId,
          })

          if (data.chats.length > 0) {
            const { currentChat, isSendingMessage, suppressAutoSelect } = get()
            const currentChatStillExists =
              currentChat && data.chats.some((c: CopilotChat) => c.id === currentChat.id)

            if (currentChatStillExists) {
              const updatedCurrentChat = data.chats.find(
                (c: CopilotChat) => c.id === currentChat!.id
              )!
              if (isSendingMessage) {
                set({ currentChat: { ...updatedCurrentChat, messages: get().messages } })
              } else {
                const normalizedMessages = normalizeMessagesForUI(updatedCurrentChat.messages ?? [])

                // Restore plan artifact and config from refreshed chat
                const refreshedPlanArtifact = updatedCurrentChat.planArtifact || ''
                const refreshedConfig = updatedCurrentChat.config ?? {}
                const refreshedMode = refreshedConfig.mode || get().mode
                const refreshedModel = refreshedConfig.model || get().selectedModel
                const toolCallsById = buildToolCallsById(normalizedMessages)

                set({
                  currentChat: updatedCurrentChat,
                  messages: normalizedMessages,
                  toolCallsById,
                  streamingPlanContent: refreshedPlanArtifact,
                  mode: refreshedMode,
                  selectedModel: refreshedModel as CopilotStore['selectedModel'],
                })
              }
              try {
                await get().loadMessageCheckpoints(updatedCurrentChat.id)
              } catch (error) {
                logger.warn('[Copilot] Failed loading checkpoints for current chat', {
                  chatId: updatedCurrentChat.id,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            } else if (!isSendingMessage && !suppressAutoSelect) {
              const mostRecentChat: CopilotChat = data.chats[0]
              const normalizedMessages = normalizeMessagesForUI(mostRecentChat.messages ?? [])

              // Restore plan artifact and config from most recent chat
              const planArtifact = mostRecentChat.planArtifact || ''
              const chatConfig = mostRecentChat.config ?? {}
              const chatMode = chatConfig.mode || get().mode
              const chatModel = chatConfig.model || get().selectedModel

              logger.info('[Chat] Auto-selecting most recent chat with config', {
                chatId: mostRecentChat.id,
                mode: chatMode,
                model: chatModel,
                hasPlanArtifact: !!planArtifact,
              })

              const toolCallsById = buildToolCallsById(normalizedMessages)

              set({
                currentChat: mostRecentChat,
                messages: normalizedMessages,
                toolCallsById,
                streamingPlanContent: planArtifact,
                mode: chatMode,
                selectedModel: chatModel as CopilotStore['selectedModel'],
              })
              try {
                await get().loadMessageCheckpoints(mostRecentChat.id)
              } catch (error) {
                logger.warn('[Copilot] Failed loading checkpoints for most recent chat', {
                  chatId: mostRecentChat.id,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }
          } else {
            set({ currentChat: null, messages: [] })
          }
        } else {
          throw new Error('Invalid response format')
        }
      } catch (error) {
        set({
          chats: [],
          isLoadingChats: false,
          chatsLoadedForWorkflow: workflowId,
          error: error instanceof Error ? error.message : 'Failed to load chats',
        })
      }
    },

    // Send a message (streaming only)
    sendMessage: async (message: string, options = {}) => {
      if (!get().autoAllowedToolsLoaded) {
        try {
          await get().loadAutoAllowedTools()
        } catch (error) {
          logger.warn('[Copilot] Failed to preload auto-allowed tools before send', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const prepared = prepareSendContext(get, set, message, options as SendMessageOptionsInput)
      if (!prepared) return

      const initiated = await initiateStream(prepared, get)
      let finalizedInitiated = initiated
      let processed = false

      if (initiated.kind === 'success') {
        try {
          processed = await processStreamEvents(initiated, prepared, get)
        } catch (error) {
          finalizedInitiated = { kind: 'error', error }
          processed = false
        }
      }

      await finalizeStream(finalizedInitiated, processed, prepared, set)
    },

    resumeActiveStream: async () => {
      const validated = await validateResumeState(get, set)
      if (!validated) return false

      const replayed = await replayBufferedEvents(validated.nextStream, get, set)
      const finalized = finalizeResume(validated.messages, replayed, get, set)
      return resumeFromLiveStream(finalized, validated.isFreshResume, get, set)
    },

    // Abort streaming
    abortMessage: (options?: { suppressContinueOption?: boolean }) => {
      const { abortController, isSendingMessage, messages } = get()
      if (!isSendingMessage || !abortController) return
      // Suppress continue option if explicitly requested OR if page is unloading (refresh/close)
      const suppressContinueOption = options?.suppressContinueOption === true || isPageUnloading()
      set({ isAborting: true, suppressAbortContinueOption: suppressContinueOption })
      try {
        abortController.abort()
        flushStreamingUpdates(set)
        const { messages: updatedMessages } = get()
        const lastMessage = updatedMessages[updatedMessages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
          const textContent =
            lastMessage.contentBlocks
              ?.filter((b) => b.type === 'text')
              .map((b) => b.content ?? '')
              .join('') || ''
          const nextContentBlocks = suppressContinueOption
            ? (lastMessage.contentBlocks ?? [])
            : appendContinueOptionBlock(
                lastMessage.contentBlocks ? [...lastMessage.contentBlocks] : []
              )
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessage.id
                ? {
                    ...msg,
                    content: suppressContinueOption
                      ? textContent.trim() || 'Message was aborted'
                      : appendContinueOption(textContent.trim() || 'Message was aborted'),
                    contentBlocks: nextContentBlocks,
                  }
                : msg
            ),
            isSendingMessage: false,
            isAborting: false,
            // Keep abortController so streaming loop can check signal.aborted
            // It will be nulled when streaming completes or new message starts
          }))
        } else {
          set({
            isSendingMessage: false,
            isAborting: false,
            // Keep abortController so streaming loop can check signal.aborted
          })
        }

        // Only clear active stream for user-initiated aborts, NOT page unload
        // During page unload, keep the stream info so we can resume after refresh
        if (!isPageUnloading()) {
          set({ activeStream: null })
          writeActiveStreamToStorage(null)
        }

        // Immediately put all in-progress tools into aborted state
        abortAllInProgressTools(set, get)

        // Persist whatever contentBlocks/text we have to keep ordering for reloads
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            void persistMessages({
              chatId: currentChat.id,
              messages: currentMessages,
              sensitiveCredentialIds: get().sensitiveCredentialIds,
              planArtifact: streamingPlanContent || null,
              mode,
              model: selectedModel,
            })
          } catch (error) {
            logger.warn('[Copilot] Failed to queue abort snapshot persistence', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } catch (error) {
        logger.warn('[Copilot] Abort flow encountered an error', {
          error: error instanceof Error ? error.message : String(error),
        })
        set({ isSendingMessage: false, isAborting: false })
        // Only clear active stream for user-initiated aborts, NOT page unload
        if (!isPageUnloading()) {
          set({ activeStream: null })
          writeActiveStreamToStorage(null)
        }
      }
    },

    // Implicit feedback (send a continuation) - minimal
    sendImplicitFeedback: async (implicitFeedback: string) => {
      const { workflowId, currentChat, mode, selectedModel } = get()
      if (!workflowId) return
      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })
      const newAssistantMessage = createStreamingMessage()
      set((state) => ({ messages: [...state.messages, newAssistantMessage] }))
      try {
        const apiMode: 'ask' | 'agent' | 'plan' =
          mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : 'agent'
        const { provider: fbProvider, modelId: fbModelId } = parseModelKey(selectedModel)
        const result = await sendStreamingMessage({
          message: 'Please continue your response.',
          chatId: currentChat?.id,
          workflowId,
          mode: apiMode,
          model: fbModelId,
          provider: fbProvider || undefined,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream: true,
          implicitFeedback,
          abortSignal: abortController.signal,
        })
        if (result.success && result.stream) {
          await get().handleStreamingResponse(
            result.stream,
            newAssistantMessage.id,
            false,
            undefined,
            abortController.signal
          )
        } else {
          if (result.error === 'Request was aborted') return
          const errorMessage = createErrorMessage(
            newAssistantMessage.id,
            result.error || 'Failed to send implicit feedback'
          )
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === newAssistantMessage.id ? errorMessage : msg
            ),
            error: result.error || 'Failed to send implicit feedback',
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          newAssistantMessage.id,
          'Sorry, I encountered an error while processing your feedback. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === newAssistantMessage.id ? errorMessage : msg
          ),
          error: error instanceof Error ? error.message : 'Failed to send implicit feedback',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Tool-call related APIs are stubbed for now
    setToolCallState: (toolCall: CopilotToolCall, newState: ClientToolCallState | string) => {
      try {
        const id: string | undefined = toolCall?.id
        if (!id) return
        const map = { ...get().toolCallsById }
        const current = map[id]
        if (!current) return
        // Preserve rejected state from being overridden
        if (
          isRejectedState(current.state) &&
          (newState === 'success' || newState === ClientToolCallState.success)
        ) {
          return
        }
        let norm: ClientToolCallState = current.state
        if (newState === 'executing') norm = ClientToolCallState.executing
        else if (newState === 'errored' || newState === 'error') norm = ClientToolCallState.error
        else if (newState === 'rejected') norm = ClientToolCallState.rejected
        else if (newState === 'pending') norm = ClientToolCallState.pending
        else if (newState === 'success' || newState === 'accepted')
          norm = ClientToolCallState.success
        else if (newState === 'aborted') norm = ClientToolCallState.aborted
        else if (newState === 'background') norm = ClientToolCallState.background
        else if (typeof newState === 'number') norm = newState as unknown as ClientToolCallState
        map[id] = {
          ...current,
          state: norm,
          display: resolveToolDisplay(current.name, norm, id, current.params),
        }
        set({ toolCallsById: map })
      } catch (error) {
        logger.warn('[Copilot] Failed to update tool call state', {
          error: error instanceof Error ? error.message : String(error),
          toolCallId: toolCall?.id,
        })
      }
    },

    updateToolCallParams: (toolCallId: string, params: Record<string, unknown>) => {
      try {
        if (!toolCallId) return
        const map = { ...get().toolCallsById }
        const current = map[toolCallId]
        if (!current) return
        const updatedParams = { ...current.params, ...params }
        map[toolCallId] = {
          ...current,
          params: updatedParams,
          display: resolveToolDisplay(current.name, current.state, toolCallId, updatedParams),
        }
        set({ toolCallsById: map })
      } catch (error) {
        logger.warn('[Copilot] Failed to update tool call params', {
          error: error instanceof Error ? error.message : String(error),
          toolCallId,
        })
      }
    },
    updatePreviewToolCallState: (
      toolCallState: 'accepted' | 'rejected' | 'error',
      toolCallId?: string
    ) => {
      const stateMap: Record<string, ClientToolCallState> = {
        accepted: ClientToolCallState.success,
        rejected: ClientToolCallState.rejected,
        error: ClientToolCallState.error,
      }
      const targetState = stateMap[toolCallState] || ClientToolCallState.success
      const { toolCallsById } = get()
      // Determine target tool
      let id = toolCallId
      if (!id) {
        // Prefer the latest assistant message's build/edit tool_call
        const messages = get().messages
        outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
          const m = messages[mi]
          if (m.role !== 'assistant' || !m.contentBlocks) continue
          const blocks = m.contentBlocks
          for (let bi = blocks.length - 1; bi >= 0; bi--) {
            const b = blocks[bi]
            if (b?.type === 'tool_call') {
              const tn = b.toolCall?.name
              if (tn === 'edit_workflow') {
                id = b.toolCall?.id
                break outer
              }
            }
          }
        }
        // Fallback to map if not found in messages
        if (!id) {
          const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
          id = candidates.length ? candidates[candidates.length - 1].id : undefined
        }
      }
      if (!id) return
      const current = toolCallsById[id]
      if (!current) return
      // Do not override a rejected tool with success
      if (isRejectedState(current.state) && targetState === ClientToolCallState.success) {
        return
      }

      // Update store map
      const updatedMap = { ...toolCallsById }
      const updatedDisplay = resolveToolDisplay(current.name, targetState, id, current.params)
      updatedMap[id] = {
        ...current,
        state: targetState,
        display: updatedDisplay,
      }
      set({ toolCallsById: updatedMap })

      // Update inline content block in the latest assistant message
      set((s) => {
        const messages = [...s.messages]
        for (let mi = messages.length - 1; mi >= 0; mi--) {
          const m = messages[mi]
          if (m.role !== 'assistant' || !m.contentBlocks) continue
          let changed = false
          const blocks = m.contentBlocks.map((b) => {
            if (b.type === 'tool_call' && b.toolCall?.id === id) {
              changed = true
              return {
                ...b,
                toolCall: {
                  ...b.toolCall,
                  id: id!,
                  name: current.name,
                  state: targetState,
                  display: updatedDisplay,
                  params: current.params,
                },
              }
            }
            return b
          })
          if (changed) {
            messages[mi] = { ...m, contentBlocks: blocks }
            break
          }
        }
        return { messages }
      })

      try {
        fetch(COPILOT_CONFIRM_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolCallId: id,
            status: toolCallState,
          }),
        }).catch((error) => {
          logger.warn('[Copilot] Failed to send tool confirmation', {
            error: error instanceof Error ? error.message : String(error),
            toolCallId: id,
            status: toolCallState,
          })
        })
      } catch (error) {
        logger.warn('[Copilot] Failed to queue tool confirmation request', {
          error: error instanceof Error ? error.message : String(error),
          toolCallId: id,
          status: toolCallState,
        })
      }
    },

    loadMessageCheckpoints: async (chatId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isLoadingCheckpoints: true, checkpointError: null })
      try {
        const response = await fetch(`${COPILOT_CHECKPOINTS_API_PATH}?chatId=${chatId}`)
        if (!response.ok) throw new Error(`Failed to load checkpoints: ${response.statusText}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.checkpoints)) {
          const grouped = (data.checkpoints as CheckpointEntry[]).reduce(
            (acc: Record<string, CheckpointEntry[]>, cp: CheckpointEntry) => {
              const key = cp.messageId || '__no_message__'
              acc[key] = acc[key] ?? []
              acc[key].push(cp)
              return acc
            },
            {}
          )
          set({ messageCheckpoints: grouped, isLoadingCheckpoints: false })
        } else {
          throw new Error('Invalid checkpoints response')
        }
      } catch (error) {
        set({
          isLoadingCheckpoints: false,
          checkpointError: error instanceof Error ? error.message : 'Failed to load checkpoints',
        })
      }
    },

    // Revert to a specific checkpoint and apply state locally
    revertToCheckpoint: async (checkpointId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isRevertingCheckpoint: true, checkpointError: null })
      try {
        const { messageCheckpoints } = get()
        const checkpointMessageId = Object.entries(messageCheckpoints).find(([, cps]) =>
          (cps ?? []).some((cp) => cp?.id === checkpointId)
        )?.[0]
        const response = await fetch(COPILOT_CHECKPOINTS_REVERT_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpointId }),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(errorText || `Failed to revert: ${response.statusText}`)
        }
        const result = await response.json()
        const reverted = result?.checkpoint?.workflowState || null
        if (reverted) {
          // Clear any active diff preview
          try {
            useWorkflowDiffStore.getState().clearDiff()
          } catch (error) {
            logger.warn('[Copilot] Failed to clear diff before checkpoint revert', {
              error: error instanceof Error ? error.message : String(error),
            })
          }

          // Apply to main workflow store
          useWorkflowStore.setState({
            blocks: reverted.blocks ?? {},
            edges: reverted.edges ?? [],
            loops: reverted.loops ?? {},
            parallels: reverted.parallels ?? {},
            lastSaved: reverted.lastSaved || Date.now(),
            deploymentStatuses: reverted.deploymentStatuses ?? {},
          })

          // Extract and apply subblock values
          const values: Record<string, Record<string, unknown>> = {}
          Object.entries(reverted.blocks ?? {}).forEach(([blockId, block]) => {
            const typedBlock = block as { subBlocks?: Record<string, { value?: unknown }> }
            values[blockId] = {}
            Object.entries(typedBlock.subBlocks ?? {}).forEach(([subId, sub]) => {
              values[blockId][subId] = sub?.value
            })
          })
          const subState = useSubBlockStore.getState()
          useSubBlockStore.setState({
            workflowValues: {
              ...subState.workflowValues,
              [workflowId]: values,
            },
          })
        }
        if (checkpointMessageId) {
          const { messageCheckpoints: currentCheckpoints } = get()
          const updatedCheckpoints = { ...currentCheckpoints, [checkpointMessageId]: [] }
          set({ messageCheckpoints: updatedCheckpoints })
        }
        set({ isRevertingCheckpoint: false })
      } catch (error) {
        set({
          isRevertingCheckpoint: false,
          checkpointError: error instanceof Error ? error.message : 'Failed to revert checkpoint',
        })
        throw error
      }
    },
    getCheckpointsForMessage: (messageId: string) => {
      const { messageCheckpoints } = get()
      return messageCheckpoints[messageId] ?? []
    },
    saveMessageCheckpoint: async (messageId: string) => {
      if (!messageId) return false
      return saveMessageCheckpoint(messageId, get, set)
    },

    // Handle streaming response
    handleStreamingResponse: async (
      stream: ReadableStream,
      assistantMessageId: string,
      isContinuation = false,
      triggerUserMessageId?: string,
      abortSignal?: AbortSignal
    ) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      const startTimeMs = Date.now()
      const expectedStreamId = triggerUserMessageId

      const context = createClientStreamingContext(assistantMessageId)
      if (isContinuation) {
        context.suppressContinueOption = true
      }

      if (isContinuation) {
        const { messages } = get()
        const existingMessage = messages.find((m) => m.id === assistantMessageId)
        logger.debug('[Copilot] Continuation init', {
          hasMessage: !!existingMessage,
          contentLength: existingMessage?.content?.length || 0,
          contentPreview: existingMessage?.content?.slice(0, 100) || '',
          contentBlocksCount: existingMessage?.contentBlocks?.length || 0,
        })
        if (existingMessage) {
          const existingBlocks = Array.isArray(existingMessage.contentBlocks)
            ? existingMessage.contentBlocks
            : []
          if (existingBlocks.length > 0) {
            const existingText = extractTextFromBlocks(existingBlocks)
            if (existingText) {
              context.accumulatedContent += existingText
            }
            const clonedBlocks = cloneContentBlocks(existingBlocks)
            context.contentBlocks = clonedBlocks
            context.currentTextBlock = findLastTextBlock(clonedBlocks)
          } else if (existingMessage.content) {
            const textBlock: ClientContentBlock = {
              type: 'text',
              content: existingMessage.content,
              timestamp: Date.now(),
              toolCall: null,
            }
            context.contentBlocks = [textBlock]
            context.currentTextBlock = textBlock
            context.accumulatedContent += existingMessage.content
          }
        }
      }

      const timeoutId = setTimeout(() => {
        logger.warn('Stream timeout reached, completing response')
        reader.cancel()
      }, STREAM_TIMEOUT_MS)

      try {
        for await (const data of parseSSEStream(reader, decoder, abortSignal)) {
          if (abortSignal?.aborted) {
            context.wasAborted = true
            const { suppressAbortContinueOption } = get()
            context.suppressContinueOption =
              suppressAbortContinueOption === true || isPageUnloading()
            if (suppressAbortContinueOption) {
              set({ suppressAbortContinueOption: false })
            }
            context.pendingContent = ''
            finalizeThinkingBlock(context)
            flushStreamingUpdates(set)
            reader.cancel()
            break
          }

          const eventMeta = data as { eventId?: unknown; streamId?: unknown }
          const eventId = typeof eventMeta.eventId === 'number' ? eventMeta.eventId : undefined
          const streamId = typeof eventMeta.streamId === 'string' ? eventMeta.streamId : undefined
          if (expectedStreamId && streamId && streamId !== expectedStreamId) {
            logger.warn('[SSE] Ignoring event for mismatched stream', {
              expectedStreamId,
              streamId,
              type: data.type,
            })
            continue
          }
          if (eventId && streamId) {
            updateActiveStreamEventId(get, set, streamId, eventId)
          }

          // Log SSE events for debugging
          logger.debug('[SSE] Received event', {
            type: data.type,
            hasSubAgent: !!data.subagent,
            subagent: data.subagent,
            dataPreview:
              typeof data.data === 'string'
                ? (data.data as string).substring(0, 100)
                : JSON.stringify(data.data)?.substring(0, 100),
          })

          const shouldContinue = await applySseEvent(data, context, get, set)
          if (!shouldContinue) break
        }

        if (!context.wasAborted && sseHandlers.stream_end) {
          sseHandlers.stream_end({ type: 'done' }, context, get, set)
        }

        stopStreamingUpdates()

        let sanitizedContentBlocks: ClientContentBlock[] = []
        if (context.contentBlocks && context.contentBlocks.length > 0) {
          const optimizedBlocks = context.contentBlocks.map((block) => ({ ...block }))
          sanitizedContentBlocks = optimizedBlocks.map((block) =>
            block.type === TEXT_BLOCK_TYPE && typeof block.content === 'string'
              ? { ...block, content: stripTodoTags(block.content) }
              : block
          )
        }
        if (isContinuation) {
          sanitizedContentBlocks = stripContinueOptionFromBlocks(sanitizedContentBlocks)
        }
        if (context.wasAborted && !context.suppressContinueOption) {
          sanitizedContentBlocks = appendContinueOptionBlock(sanitizedContentBlocks)
        }

        if (!context.streamComplete && !context.wasAborted) {
          const resumed = await get().resumeActiveStream()
          if (resumed) {
            return
          }
        }

        const finalContent = stripTodoTags(context.accumulatedContent)
        const finalContentStripped = isContinuation
          ? stripContinueOption(finalContent)
          : finalContent
        const finalContentWithOptions =
          context.wasAborted && !context.suppressContinueOption
            ? appendContinueOption(finalContent)
            : finalContentStripped
        // Step 1: Update messages in state but keep isSendingMessage: true.
        // This prevents loadChats from overwriting with stale DB data during persist.
        set((state) => {
          const snapshotId = state.currentUserMessageId
          const nextSnapshots =
            snapshotId && state.messageSnapshots[snapshotId]
              ? (() => {
                  const updated = { ...state.messageSnapshots }
                  delete updated[snapshotId]
                  return updated
                })()
              : state.messageSnapshots
          const nextState: Partial<CopilotStore> = {
            messages: state.messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: finalContentWithOptions,
                    contentBlocks: sanitizedContentBlocks,
                  }
                : msg
            ),
            isAborting: false,
            currentUserMessageId: null,
            messageSnapshots: nextSnapshots,
          }
          return nextState
        })

        // Only clear active stream if stream completed normally or user aborted (not page unload)
        if ((context.streamComplete || context.wasAborted) && !isPageUnloading()) {
          set({ activeStream: null })
          writeActiveStreamToStorage(null)
        }

        if (context.newChatId && !get().currentChat) {
          await get().handleNewChatCreation(context.newChatId)
        }

        // Step 2: Persist messages to DB BEFORE marking stream as done.
        // loadChats checks isSendingMessage — while true it preserves in-memory messages.
        // Persisting first ensures the DB is up-to-date before we allow overwrites.
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            // Debug: Log what we're about to serialize
            const lastMsg = currentMessages[currentMessages.length - 1]
            if (lastMsg?.role === 'assistant') {
              logger.debug('[Stream Done] About to serialize - last message state', {
                id: lastMsg.id,
                contentLength: lastMsg.content?.length || 0,
                hasContentBlocks: !!lastMsg.contentBlocks,
                contentBlockCount: lastMsg.contentBlocks?.length || 0,
                contentBlockTypes: lastMsg.contentBlocks?.map((b) => b?.type) ?? [],
              })
            }
            const config = {
              mode,
              model: selectedModel,
            }

            const persisted = await persistMessages({
              chatId: currentChat.id,
              messages: currentMessages,
              sensitiveCredentialIds: get().sensitiveCredentialIds,
              planArtifact: streamingPlanContent || null,
              mode,
              model: selectedModel,
            })

            if (!persisted) {
              logger.error('[Stream Done] Failed to save messages to DB', {
                chatId: currentChat.id,
              })
            } else {
              logger.info('[Stream Done] Successfully saved messages to DB', {
                messageCount: currentMessages.length,
              })
            }

            // Update local chat object with plan artifact and config
            set({
              currentChat: {
                ...currentChat,
                planArtifact: streamingPlanContent || null,
                config,
              },
            })
          } catch (err) {
            logger.error('[Stream Done] Exception saving messages', { error: String(err) })
          }
        }

        // Step 3: NOW mark stream as done. DB is up-to-date, so if loadChats
        // overwrites messages it will use the persisted (correct) data.
        set({ isSendingMessage: false, abortController: null })

        // Process next message in queue if any
        const nextInQueue = get().messageQueue[0]
        if (nextInQueue) {
          // Use originalMessageId if available (from edit/resend), otherwise use queue entry id
          const messageIdToUse = nextInQueue.originalMessageId || nextInQueue.id
          logger.debug('[Queue] Processing next queued message', {
            id: nextInQueue.id,
            originalMessageId: nextInQueue.originalMessageId,
            messageIdToUse,
            queueLength: get().messageQueue.length,
          })
          // Remove from queue and send
          get().removeFromQueue(nextInQueue.id)
          // Use setTimeout to avoid blocking the current execution
          setTimeout(() => {
            get().sendMessage(nextInQueue.content, {
              stream: true,
              fileAttachments: nextInQueue.fileAttachments,
              contexts: nextInQueue.contexts,
              messageId: messageIdToUse,
            })
          }, QUEUE_PROCESS_DELAY_MS)
        }

        // Invalidate subscription queries to update usage
        setTimeout(() => {
          const queryClient = getQueryClient()
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
        }, SUBSCRIPTION_INVALIDATE_DELAY_MS)
      } finally {
        clearTimeout(timeoutId)
      }
    },

    // Handle new chat creation from stream
    handleNewChatCreation: async (newChatId: string) => {
      const { mode, selectedModel, streamingPlanContent } = get()
      const newChat: CopilotChat = {
        id: newChatId,
        title: null,
        model: selectedModel,
        messages: get().messages,
        messageCount: get().messages.length,
        planArtifact: streamingPlanContent || null,
        config: {
          mode,
          model: selectedModel,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      // Abort any in-progress tools and clear diff on new chat creation
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch (error) {
        logger.warn('[Copilot] Failed to clear diff on new chat creation', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      set({
        currentChat: newChat,
        chats: [newChat, ...(get().chats ?? [])],
        chatsLastLoadedAt: null,
        chatsLoadedForWorkflow: null,
        planTodos: [],
        showPlanTodos: false,
        suppressAutoSelect: false,
      })
    },

    // Utilities
    clearError: () => set({ error: null }),
    clearSaveError: () => set({ saveError: null }),
    clearCheckpointError: () => set({ checkpointError: null }),
    cleanup: () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      stopStreamingUpdates()
      // Clear any diff on cleanup
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch (error) {
        logger.warn('[Copilot] Failed to clear diff on cleanup', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    reset: () => {
      get().cleanup()
      // Abort in-progress tools prior to reset
      abortAllInProgressTools(set, get)
      set(initialState)
    },

    // Input controls
    setInputValue: (value: string) => set({ inputValue: value }),
    clearRevertState: () => set({ revertState: null }),

    // Todo list (UI only)
    setPlanTodos: (todos) => set({ planTodos: todos, showPlanTodos: true }),
    updatePlanTodoStatus: (id, status) => {
      set((state) => {
        const updated = state.planTodos.map((t) =>
          t.id === id
            ? { ...t, completed: status === 'completed', executing: status === 'executing' }
            : t
        )
        return { planTodos: updated }
      })
    },
    closePlanTodos: () => set({ showPlanTodos: false }),

    clearPlanArtifact: async () => {
      const { currentChat } = get()

      // Clear from local state
      set({ streamingPlanContent: '' })

      // Update database if we have a current chat
      if (currentChat) {
        try {
          const currentMessages = get().messages
          const { mode, selectedModel } = get()
          await persistMessages({
            chatId: currentChat.id,
            messages: currentMessages,
            sensitiveCredentialIds: get().sensitiveCredentialIds,
            planArtifact: null,
            mode,
            model: selectedModel,
          })

          // Update local chat object
          set({
            currentChat: {
              ...currentChat,
              planArtifact: null,
            },
          })

          logger.info('[PlanArtifact] Cleared plan artifact', { chatId: currentChat.id })
        } catch (error) {
          logger.error('[PlanArtifact] Failed to clear plan artifact', error)
        }
      }
    },

    savePlanArtifact: async (content: string) => {
      const { currentChat } = get()

      // Update local state
      set({ streamingPlanContent: content })

      // Update database if we have a current chat
      if (currentChat) {
        try {
          const currentMessages = get().messages
          const { mode, selectedModel } = get()
          await persistMessages({
            chatId: currentChat.id,
            messages: currentMessages,
            sensitiveCredentialIds: get().sensitiveCredentialIds,
            planArtifact: content,
            mode,
            model: selectedModel,
          })

          // Update local chat object
          set({
            currentChat: {
              ...currentChat,
              planArtifact: content,
            },
          })

          logger.info('[PlanArtifact] Saved plan artifact', {
            chatId: currentChat.id,
            contentLength: content.length,
          })
        } catch (error) {
          logger.error('[PlanArtifact] Failed to save plan artifact', error)
        }
      }
    },

    setSelectedModel: async (model) => {
      set({ selectedModel: model })
    },
    setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),
    loadAvailableModels: async () => {
      set({ isLoadingModels: true })
      try {
        const response = await fetch(COPILOT_MODELS_API_PATH, { method: 'GET' })
        if (!response.ok) {
          throw new Error(`Failed to fetch available models: ${response.status}`)
        }

        const data = await response.json()
        const models: unknown[] = Array.isArray(data?.models) ? data.models : []

        const normalizedModels: AvailableModel[] = models
          .filter((model: unknown): model is AvailableModel => {
            return (
              typeof model === 'object' &&
              model !== null &&
              'id' in model &&
              typeof (model as { id: unknown }).id === 'string'
            )
          })
          .map((model: AvailableModel) => {
            const provider = model.provider || 'unknown'
            // Use composite provider/modelId keys (matching agent block pattern in providers/models.ts)
            // so models with the same raw ID from different providers are uniquely identified.
            const compositeId = `${provider}/${model.id}`
            return {
              id: compositeId,
              friendlyName: model.friendlyName || model.id,
              provider,
            }
          })

        const { selectedModel } = get()
        const selectedModelExists = normalizedModels.some((model) => model.id === selectedModel)

        // Pick the best default: prefer claude-opus-4-6 with provider priority:
        // direct anthropic > bedrock > azure-anthropic > any other.
        let nextSelectedModel = selectedModel
        if (!selectedModelExists && normalizedModels.length > 0) {
          const providerPriority = ['anthropic', 'bedrock', 'azure-anthropic']
          let opus46: AvailableModel | undefined
          for (const prov of providerPriority) {
            opus46 = normalizedModels.find((m) => m.id === `${prov}/claude-opus-4-6`)
            if (opus46) break
          }
          if (!opus46) opus46 = normalizedModels.find((m) => m.id.endsWith('/claude-opus-4-6'))
          nextSelectedModel = opus46 ? opus46.id : normalizedModels[0].id
        }

        set({
          availableModels: normalizedModels,
          selectedModel: nextSelectedModel as CopilotStore['selectedModel'],
          isLoadingModels: false,
        })
      } catch (error) {
        logger.warn('[Copilot] Failed to load available models', {
          error: error instanceof Error ? error.message : String(error),
        })
        set({ isLoadingModels: false })
      }
    },

    loadAutoAllowedTools: async () => {
      try {
        logger.debug('[AutoAllowedTools] Loading from API...')
        const res = await fetch(COPILOT_AUTO_ALLOWED_TOOLS_API_PATH)
        logger.debug('[AutoAllowedTools] Load response', { status: res.status, ok: res.ok })
        if (res.ok) {
          const data = await res.json()
          const tools = data.autoAllowedTools ?? []
          set({ autoAllowedTools: tools, autoAllowedToolsLoaded: true })
          writeAutoAllowedToolsToStorage(tools)
          logger.debug('[AutoAllowedTools] Loaded successfully', { count: tools.length, tools })
        } else {
          set({ autoAllowedToolsLoaded: true })
          logger.warn('[AutoAllowedTools] Load failed with status', { status: res.status })
        }
      } catch (err) {
        set({ autoAllowedToolsLoaded: true })
        logger.error('[AutoAllowedTools] Failed to load', { error: err })
      }
    },

    addAutoAllowedTool: async (toolId: string) => {
      try {
        logger.debug('[AutoAllowedTools] Adding tool...', { toolId })
        const res = await fetch(COPILOT_AUTO_ALLOWED_TOOLS_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolId }),
        })
        logger.debug('[AutoAllowedTools] API response', { toolId, status: res.status, ok: res.ok })
        if (res.ok) {
          const data = await res.json()
          logger.debug('[AutoAllowedTools] API returned', { toolId, tools: data.autoAllowedTools })
          const tools = data.autoAllowedTools ?? []
          set({ autoAllowedTools: tools, autoAllowedToolsLoaded: true })
          writeAutoAllowedToolsToStorage(tools)
          logger.debug('[AutoAllowedTools] Added tool to store', { toolId })
        }
      } catch (err) {
        logger.error('[AutoAllowedTools] Failed to add tool', { toolId, error: err })
      }
    },

    removeAutoAllowedTool: async (toolId: string) => {
      try {
        const res = await fetch(
          `${COPILOT_AUTO_ALLOWED_TOOLS_API_PATH}?toolId=${encodeURIComponent(toolId)}`,
          {
            method: 'DELETE',
          }
        )
        if (res.ok) {
          const data = await res.json()
          const tools = data.autoAllowedTools ?? []
          set({ autoAllowedTools: tools, autoAllowedToolsLoaded: true })
          writeAutoAllowedToolsToStorage(tools)
          logger.debug('[AutoAllowedTools] Removed tool', { toolId })
        }
      } catch (err) {
        logger.error('[AutoAllowedTools] Failed to remove tool', { toolId, error: err })
      }
    },

    isToolAutoAllowed: (toolId: string) => {
      const { autoAllowedTools } = get()
      return isToolAutoAllowedByList(toolId, autoAllowedTools)
    },

    // Credential masking
    loadSensitiveCredentialIds: async () => {
      try {
        const res = await fetch(COPILOT_CREDENTIALS_API_PATH, {
          credentials: 'include',
        })
        if (!res.ok) {
          logger.warn('[loadSensitiveCredentialIds] Failed to fetch credentials', {
            status: res.status,
          })
          return
        }
        const json = await res.json()
        // Credentials are at result.oauth.connected.credentials
        const credentials = json?.result?.oauth?.connected?.credentials ?? []
        logger.debug('[loadSensitiveCredentialIds] Response', {
          hasResult: !!json?.result,
          credentialCount: credentials.length,
        })
        const ids = new Set<string>()
        for (const cred of credentials) {
          if (cred?.id) {
            ids.add(cred.id)
          }
        }
        set({ sensitiveCredentialIds: ids })
        logger.debug('[loadSensitiveCredentialIds] Loaded credential IDs', {
          count: ids.size,
        })
      } catch (err) {
        logger.warn('[loadSensitiveCredentialIds] Error loading credentials', err)
      }
    },

    maskCredentialValue: (value: string) => {
      const { sensitiveCredentialIds } = get()
      if (!value || sensitiveCredentialIds.size === 0) return value

      let masked = value
      // Sort by length descending to mask longer IDs first
      const sortedIds = Array.from(sensitiveCredentialIds).sort((a, b) => b.length - a.length)
      for (const id of sortedIds) {
        if (id && masked.includes(id)) {
          masked = masked.split(id).join('••••••••')
        }
      }
      return masked
    },

    // Message queue actions
    addToQueue: (message, options) => {
      const queuedMessage: import('./types').QueuedMessage = {
        id: crypto.randomUUID(),
        content: message,
        fileAttachments: options?.fileAttachments,
        contexts: options?.contexts,
        queuedAt: Date.now(),
        originalMessageId: options?.messageId,
      }
      set({ messageQueue: [...get().messageQueue, queuedMessage] })
      logger.info('[Queue] Message added to queue', {
        id: queuedMessage.id,
        originalMessageId: options?.messageId,
        queueLength: get().messageQueue.length,
      })
    },

    removeFromQueue: (id) => {
      set({ messageQueue: get().messageQueue.filter((m) => m.id !== id) })
      logger.debug('[Queue] Message removed from queue', {
        id,
        queueLength: get().messageQueue.length,
      })
    },

    moveUpInQueue: (id) => {
      const queue = [...get().messageQueue]
      const index = queue.findIndex((m) => m.id === id)
      if (index > 0) {
        const item = queue[index]
        queue.splice(index, 1)
        queue.splice(index - 1, 0, item)
        set({ messageQueue: queue })
        logger.debug('[Queue] Message moved up in queue', { id, newIndex: index - 1 })
      }
    },

    sendNow: async (id) => {
      const queue = get().messageQueue
      const message = queue.find((m) => m.id === id)
      if (!message) return

      // Remove from queue first
      get().removeFromQueue(id)

      // If currently sending, abort and send this one
      const { isSendingMessage } = get()
      if (isSendingMessage) {
        get().abortMessage({ suppressContinueOption: true })
        // Wait a tick for abort to complete
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Use originalMessageId if available (from edit/resend), otherwise use queue entry id
      const messageIdToUse = message.originalMessageId || message.id

      // Send the message
      await get().sendMessage(message.content, {
        stream: true,
        fileAttachments: message.fileAttachments,
        contexts: message.contexts,
        messageId: messageIdToUse,
      })
    },

    clearQueue: () => {
      set({ messageQueue: [] })
      logger.info('[Queue] Queue cleared')
    },
  }))
)
