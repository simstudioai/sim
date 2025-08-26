'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import type {
  BaseClientToolMetadata,
  ClientToolDisplay,
} from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-metadata'
import { ListGDriveFilesClientTool } from '@/lib/copilot/tools/client/gdrive/list-files'
import { ReadGDriveFileClientTool } from '@/lib/copilot/tools/client/gdrive/read-file'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import {
  getClientTool,
  registerClientTool,
  registerToolStateSync,
} from '@/lib/copilot/tools/client/manager'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client/other/make-api-request'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client/other/search-documentation'
import { SearchOnlineClientTool } from '@/lib/copilot/tools/client/other/search-online'
import { createExecutionContext, getTool } from '@/lib/copilot/tools/client/registry'
import { GetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/get-environment-variables'
import { GetOAuthCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-oauth-credentials'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/set-environment-variables'
import { BuildWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/build-workflow'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { GetUserWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-console'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  MessageFileAttachment,
} from '@/stores/copilot/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('CopilotStore')

// On module load, clear any lingering diff preview (fresh page refresh)
try {
  const diffStore = useWorkflowDiffStore.getState()
  if (diffStore?.isShowingDiff || diffStore?.diffWorkflow) {
    diffStore.clearDiff()
  }
} catch {}

// Known class-based client tools: map tool name -> instantiator
const CLIENT_TOOL_INSTANTIATORS: Record<string, (id: string) => any> = {
  run_workflow: (id) => new RunWorkflowClientTool(id),
  get_workflow_console: (id) => new GetWorkflowConsoleClientTool(id),
  get_blocks_and_tools: (id) => new GetBlocksAndToolsClientTool(id),
  get_blocks_metadata: (id) => new GetBlocksMetadataClientTool(id),
  search_online: (id) => new SearchOnlineClientTool(id),
  search_documentation: (id) => new SearchDocumentationClientTool(id),
  get_environment_variables: (id) => new GetEnvironmentVariablesClientTool(id),
  set_environment_variables: (id) => new SetEnvironmentVariablesClientTool(id),
  list_gdrive_files: (id) => new ListGDriveFilesClientTool(id),
  read_gdrive_file: (id) => new ReadGDriveFileClientTool(id),
  get_oauth_credentials: (id) => new GetOAuthCredentialsClientTool(id),
  make_api_request: (id) => new MakeApiRequestClientTool(id),
  plan: (id) => new PlanClientTool(id),
  checkoff_todo: (id) => new CheckoffTodoClientTool(id),
  mark_todo_in_progress: (id) => new MarkTodoInProgressClientTool(id),
  gdrive_request_access: (id) => new GDriveRequestAccessClientTool(id),
  edit_workflow: (id) => new EditWorkflowClientTool(id),
  build_workflow: (id) => new BuildWorkflowClientTool(id),
  get_user_workflow: (id) => new GetUserWorkflowClientTool(id),
}

// Read-only static metadata for class-based tools (no instances)
export const CLASS_TOOL_METADATA: Record<string, BaseClientToolMetadata | undefined> = {
  run_workflow: (RunWorkflowClientTool as any)?.metadata,
  get_workflow_console: (GetWorkflowConsoleClientTool as any)?.metadata,
  get_blocks_and_tools: (GetBlocksAndToolsClientTool as any)?.metadata,
  get_blocks_metadata: (GetBlocksMetadataClientTool as any)?.metadata,
  search_online: (SearchOnlineClientTool as any)?.metadata,
  search_documentation: (SearchDocumentationClientTool as any)?.metadata,
  get_environment_variables: (GetEnvironmentVariablesClientTool as any)?.metadata,
  set_environment_variables: (SetEnvironmentVariablesClientTool as any)?.metadata,
  list_gdrive_files: (ListGDriveFilesClientTool as any)?.metadata,
  read_gdrive_file: (ReadGDriveFileClientTool as any)?.metadata,
  get_oauth_credentials: (GetOAuthCredentialsClientTool as any)?.metadata,
  make_api_request: (MakeApiRequestClientTool as any)?.metadata,
  plan: (PlanClientTool as any)?.metadata,
  checkoff_todo: (CheckoffTodoClientTool as any)?.metadata,
  mark_todo_in_progress: (MarkTodoInProgressClientTool as any)?.metadata,
  gdrive_request_access: (GDriveRequestAccessClientTool as any)?.metadata,
  edit_workflow: (EditWorkflowClientTool as any)?.metadata,
  build_workflow: (BuildWorkflowClientTool as any)?.metadata,
  get_user_workflow: (GetUserWorkflowClientTool as any)?.metadata,
}

function ensureClientToolInstance(toolName: string | undefined, toolCallId: string | undefined) {
  try {
    if (!toolName || !toolCallId) return
    if (getClientTool(toolCallId)) return
    const make = CLIENT_TOOL_INSTANTIATORS[toolName]
    if (make) {
      const inst = make(toolCallId)
      registerClientTool(toolCallId, inst)
    }
  } catch {}
}

// Constants
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6

// Resolve display text/icon for a tool based on its state
function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (!toolName) return undefined
    const def = getTool(toolName) as any
    const meta = def?.metadata?.displayNames || CLASS_TOOL_METADATA[toolName]?.displayNames || {}
    // Exact state first
    const ds = meta?.[state]
    if (ds?.text || ds?.icon) return { text: ds.text, icon: ds.icon }
    // Fallback order (prefer pre-execution states for unknown states like pending)
    const fallbackOrder: ClientToolCallState[] = [
      (ClientToolCallState as any).generating,
      (ClientToolCallState as any).executing,
      (ClientToolCallState as any).review,
      (ClientToolCallState as any).success,
      (ClientToolCallState as any).error,
      (ClientToolCallState as any).rejected,
    ]
    for (const key of fallbackOrder) {
      const cand = meta?.[key]
      if (cand?.text || cand?.icon) return { text: cand.text, icon: cand.icon }
    }
  } catch {}
  // Humanized fallback as last resort
  try {
    if (toolName) {
      const text = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return { text, icon: undefined as any }
    }
  } catch {}
  return undefined
}

// Helper: check if a tool state is rejected
function isRejectedState(state: any): boolean {
  try {
    return state === 'rejected' || state === (ClientToolCallState as any).rejected
  } catch {
    return state === 'rejected'
  }
}

// Helper: check if a tool state is review (terminal for build/edit preview)
function isReviewState(state: any): boolean {
  try {
    return state === 'review' || state === (ClientToolCallState as any).review
  } catch {
    return state === 'review'
  }
}

// Helper: check if a tool state is background (terminal)
function isBackgroundState(state: any): boolean {
  try {
    return state === 'background' || state === (ClientToolCallState as any).background
  } catch {
    return state === 'background'
  }
}

// Helper: abort all in-progress client tools and update inline blocks
function abortAllInProgressTools(set: any, get: () => CopilotStore) {
  try {
    const { toolCallsById, messages } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds = new Set<string>()
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
      // Abort anything not already terminal success/error/rejected/aborted
      const isTerminal =
        st === ClientToolCallState.success ||
        st === ClientToolCallState.error ||
        st === ClientToolCallState.rejected ||
        st === ClientToolCallState.aborted
      if (!isTerminal || isReviewState(st)) {
        abortedIds.add(id)
        updatedMap[id] = {
          ...tc,
          state: ClientToolCallState.aborted,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
        }
      }
    }
    if (abortedIds.size > 0) {
      set({ toolCallsById: updatedMap })
      // Update inline blocks in-place for the latest assistant message only (most relevant)
      set((s: CopilotStore) => {
        const msgs = [...s.messages]
        for (let mi = msgs.length - 1; mi >= 0; mi--) {
          const m = msgs[mi] as any
          if (m.role !== 'assistant' || !Array.isArray(m.contentBlocks)) continue
          let changed = false
          const blocks = m.contentBlocks.map((b: any) => {
            if (b?.type === 'tool_call' && b.toolCall?.id && abortedIds.has(b.toolCall.id)) {
              changed = true
              const prev = b.toolCall
              return {
                ...b,
                toolCall: {
                  ...prev,
                  state: ClientToolCallState.aborted,
                  display: resolveToolDisplay(
                    prev?.name,
                    ClientToolCallState.aborted,
                    prev?.id,
                    prev?.params
                  ),
                },
              }
            }
            return b
          })
          if (changed) {
            msgs[mi] = { ...m, contentBlocks: blocks }
            break
          }
        }
        return { messages: msgs }
      })
    }
  } catch {}
}

// Normalize loaded messages so assistant messages render correctly from DB
function normalizeMessagesForUI(messages: CopilotMessage[]): CopilotMessage[] {
  try {
    return messages.map((message) => {
      if (message.role !== 'assistant') return message

      // Use existing contentBlocks ordering if present; otherwise only render text content
      const blocks: any[] = Array.isArray(message.contentBlocks)
        ? (message.contentBlocks as any[]).map((b: any) =>
            b?.type === 'tool_call' && b.toolCall
              ? {
                  ...b,
                  toolCall: {
                    ...b.toolCall,
                    state:
                      isRejectedState(b.toolCall?.state) ||
                      isReviewState(b.toolCall?.state) ||
                      isBackgroundState(b.toolCall?.state) ||
                      b.toolCall?.state === ClientToolCallState.success ||
                      b.toolCall?.state === ClientToolCallState.error ||
                      b.toolCall?.state === ClientToolCallState.aborted
                        ? b.toolCall.state
                        : ClientToolCallState.rejected,
                    display: resolveToolDisplay(
                      b.toolCall?.name,
                      (isRejectedState(b.toolCall?.state) ||
                      isReviewState(b.toolCall?.state) ||
                      isBackgroundState(b.toolCall?.state) ||
                      b.toolCall?.state === ClientToolCallState.success ||
                      b.toolCall?.state === ClientToolCallState.error ||
                      b.toolCall?.state === ClientToolCallState.aborted
                        ? (b.toolCall?.state as any)
                        : ClientToolCallState.rejected) as any,
                      b.toolCall?.id,
                      b.toolCall?.params
                    ),
                  },
                }
              : b
          )
        : []

      // Prepare toolCalls with display for non-block UI components, but do not fabricate blocks
      const updatedToolCalls = Array.isArray((message as any).toolCalls)
        ? (message as any).toolCalls.map((tc: any) => ({
            ...tc,
            state:
              isRejectedState(tc?.state) ||
              isReviewState(tc?.state) ||
              isBackgroundState(tc?.state) ||
              tc?.state === ClientToolCallState.success ||
              tc?.state === ClientToolCallState.error ||
              tc?.state === ClientToolCallState.aborted
                ? tc.state
                : ClientToolCallState.rejected,
            display: resolveToolDisplay(
              tc?.name,
              (isRejectedState(tc?.state) ||
              isReviewState(tc?.state) ||
              isBackgroundState(tc?.state) ||
              tc?.state === ClientToolCallState.success ||
              tc?.state === ClientToolCallState.error ||
              tc?.state === ClientToolCallState.aborted
                ? (tc?.state as any)
                : ClientToolCallState.rejected) as any,
              tc?.id,
              tc?.params
            ),
          }))
        : (message as any).toolCalls

      return {
        ...message,
        ...(updatedToolCalls && { toolCalls: updatedToolCalls }),
        ...(blocks.length > 0
          ? { contentBlocks: blocks }
          : message.content?.trim()
            ? { contentBlocks: [{ type: 'text', content: message.content, timestamp: Date.now() }] }
            : {}),
      }
    })
  } catch {
    return messages
  }
}

// Simple object pool for content blocks
class ObjectPool<T> {
  private pool: T[] = []
  private createFn: () => T
  private resetFn: (obj: T) => void

  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = 5) {
    this.createFn = createFn
    this.resetFn = resetFn
    for (let i = 0; i < initialSize; i++) this.pool.push(createFn())
  }
  get(): T {
    const obj = this.pool.pop()
    if (obj) {
      this.resetFn(obj)
      return obj
    }
    return this.createFn()
  }
  release(obj: T): void {
    if (this.pool.length < 20) this.pool.push(obj)
  }
}

const contentBlockPool = new ObjectPool(
  () => ({ type: '', content: '', timestamp: 0, toolCall: null as any }),
  (obj) => {
    obj.type = ''
    obj.content = ''
    obj.timestamp = 0
    ;(obj as any).toolCall = null
    ;(obj as any).startTime = undefined
    ;(obj as any).duration = undefined
  }
)

// Efficient string builder
class StringBuilder {
  private parts: string[] = []
  private length = 0
  append(str: string): void {
    this.parts.push(str)
    this.length += str.length
  }
  toString(): string {
    const result = this.parts.join('')
    this.clear()
    return result
  }
  clear(): void {
    this.parts.length = 0
    this.length = 0
  }
  get size(): number {
    return this.length
  }
}

// Helpers
function createUserMessage(
  content: string,
  fileAttachments?: MessageFileAttachment[]
): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
  }
}

function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
  }
}

function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return messages
    .map((msg) => {
      // Build content from blocks if assistant content is empty (exclude thinking)
      let content = msg.content || ''
      if (msg.role === 'assistant' && !content.trim() && msg.contentBlocks?.length) {
        content = msg.contentBlocks
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => String(b.content || ''))
          .join('')
          .trim()
      }

      // Strip thinking tags from content
      if (content) {
        content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
      }

      return {
        id: msg.id,
        role: msg.role,
        content,
        timestamp: msg.timestamp,
        ...(Array.isArray((msg as any).toolCalls) &&
          (msg as any).toolCalls.length > 0 && {
            toolCalls: (msg as any).toolCalls,
          }),
        ...(Array.isArray(msg.contentBlocks) &&
          msg.contentBlocks.length > 0 && {
            // Persist full contentBlocks including thinking so history can render it
            contentBlocks: msg.contentBlocks,
          }),
        ...(msg.fileAttachments &&
          msg.fileAttachments.length > 0 && {
            fileAttachments: msg.fileAttachments,
          }),
      }
    })
    .filter((m) => {
      if (m.role === 'assistant') {
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0
        const hasTools = Array.isArray((m as any).toolCalls) && (m as any).toolCalls.length > 0
        const hasBlocks =
          Array.isArray((m as any).contentBlocks) && (m as any).contentBlocks.length > 0
        return hasText || hasTools || hasBlocks
      }
      return true
    })
}

// Streaming context and SSE parsing
interface StreamingContext {
  messageId: string
  accumulatedContent: StringBuilder
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
}

type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

const sseHandlers: Record<string, SSEHandler> = {
  chat_id: async (data, context, get) => {
    context.newChatId = data.chatId
    const { currentChat } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
  },
  tool_result: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const skipped: boolean = data?.result?.skipped === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          // Preserve terminal review/rejected state; do not override
          return
        }
        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })

        // If checkoff_todo succeeded, mark todo as completed in planTodos
        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch {}
        }

        // If mark_todo_in_progress succeeded, set todo executing in planTodos
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch {}
        }
      }

      // Update inline content block state
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = success
            ? ClientToolCallState.success
            : failedDependency || skipped
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_error: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const failedDependency: boolean = data?.failedDependency === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_generating: (data, context, get, set) => {
    const { toolCallId, toolName } = data
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(toolName, toolCallId)

    if (!toolCallsById[toolCallId]) {
      // Show as pending until we receive full tool_call (with arguments) to decide execution
      const initialState = ClientToolCallState.pending
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: initialState,
        display: resolveToolDisplay(toolName, initialState, toolCallId),
      }
      const updated = { ...toolCallsById, [toolCallId]: tc }
      set({ toolCallsById: updated })
      logger.info('[toolCallsById] map updated', updated)

      // Add/refresh inline content block
      let found = false
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b.type === 'tool_call' && b.toolCall?.id === toolCallId) {
          context.contentBlocks[i] = { ...b, toolCall: tc }
          found = true
          break
        }
      }
      if (!found)
        context.contentBlocks.push({ type: 'tool_call', toolCall: tc, timestamp: Date.now() })
      updateStreamingMessage(set, context)
    }
  },
  tool_call: (data, context, get, set) => {
    const toolData = data?.data || {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id) return
    const args = toolData.arguments
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(name, id)

    const existing = toolCallsById[id]
    const next: CopilotToolCall = existing
      ? {
          ...existing,
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
      : {
          id,
          name: name || 'unknown_tool',
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
    const updated = { ...toolCallsById, [id]: next }
    set({ toolCallsById: updated })
    logger.info('[toolCallsById] → pending', { id, name, params: args })

    // Ensure an inline content block exists/updated for this tool call
    let found = false
    for (let i = 0; i < context.contentBlocks.length; i++) {
      const b = context.contentBlocks[i] as any
      if (b.type === 'tool_call' && b.toolCall?.id === id) {
        context.contentBlocks[i] = { ...b, toolCall: next }
        found = true
        break
      }
    }
    if (!found) {
      context.contentBlocks.push({ type: 'tool_call', toolCall: next, timestamp: Date.now() })
    }
    updateStreamingMessage(set, context)

    // Prefer interface-based registry to determine interrupt and execute
    try {
      const def = name ? getTool(name) : undefined
      if (def) {
        const hasInterrupt =
          typeof def.hasInterrupt === 'function'
            ? !!def.hasInterrupt(args || {})
            : !!def.hasInterrupt
        if (!hasInterrupt && typeof def.execute === 'function') {
          const ctx = createExecutionContext({ toolCallId: id, toolName: name || 'unknown_tool' })
          // Defer executing transition by a tick to let pending render
          setTimeout(() => {
            const executingMap = { ...get().toolCallsById }
            executingMap[id] = {
              ...executingMap[id],
              state: ClientToolCallState.executing,
              display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
            }
            set({ toolCallsById: executingMap })
            logger.info('[toolCallsById] pending → executing (registry)', { id, name })

            // Update inline content block to executing
            for (let i = 0; i < context.contentBlocks.length; i++) {
              const b = context.contentBlocks[i] as any
              if (b.type === 'tool_call' && b.toolCall?.id === id) {
                context.contentBlocks[i] = {
                  ...b,
                  toolCall: { ...b.toolCall, state: ClientToolCallState.executing },
                }
                break
              }
            }
            updateStreamingMessage(set, context)

            Promise.resolve()
              .then(async () => {
                const result = await def.execute(ctx, args || {})
                const success =
                  result && typeof result.status === 'number'
                    ? result.status >= 200 && result.status < 300
                    : true
                const completeMap = { ...get().toolCallsById }
                // Do not override terminal review/rejected
                if (
                  isRejectedState(completeMap[id]?.state) ||
                  isReviewState(completeMap[id]?.state) ||
                  isBackgroundState(completeMap[id]?.state)
                ) {
                  return
                }
                completeMap[id] = {
                  ...completeMap[id],
                  state: success ? ClientToolCallState.success : ClientToolCallState.error,
                  display: resolveToolDisplay(
                    name,
                    success ? ClientToolCallState.success : ClientToolCallState.error,
                    id,
                    args
                  ),
                }
                set({ toolCallsById: completeMap })
                logger.info(
                  `[toolCallsById] executing → ${success ? 'success' : 'error'} (registry)`,
                  { id, name }
                )

                // Notify backend tool mark-complete endpoint
                try {
                  await fetch('/api/copilot/tools/mark-complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id,
                      name: name || 'unknown_tool',
                      status:
                        typeof result?.status === 'number' ? result.status : success ? 200 : 500,
                      message: result?.message,
                      data: result?.data,
                    }),
                  })
                } catch {}
              })
              .catch((e) => {
                const errorMap = { ...get().toolCallsById }
                // Do not override terminal review/rejected
                if (
                  isRejectedState(errorMap[id]?.state) ||
                  isReviewState(errorMap[id]?.state) ||
                  isBackgroundState(errorMap[id]?.state)
                ) {
                  return
                }
                errorMap[id] = {
                  ...errorMap[id],
                  state: ClientToolCallState.error,
                  display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
                }
                set({ toolCallsById: errorMap })
                logger.error('Registry auto-execute tool failed', { id, name, error: e })
              })
          }, 0)
          return
        }
      }
    } catch (e) {
      logger.warn('tool_call registry auto-exec check failed', { id, name, error: e })
    }

    // Class-based auto-exec for non-interrupt tools
    try {
      const inst = getClientTool(id) as any
      const hasInterrupt = !!inst?.getInterruptDisplays?.()
      if (!hasInterrupt && typeof inst?.execute === 'function') {
        setTimeout(() => {
          const executingMap = { ...get().toolCallsById }
          executingMap[id] = {
            ...executingMap[id],
            state: ClientToolCallState.executing,
            display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
          }
          set({ toolCallsById: executingMap })
          logger.info('[toolCallsById] pending → executing (class)', { id, name })

          Promise.resolve()
            .then(async () => {
              await inst.execute(args || {})
              // Success/error will be synced via registerToolStateSync
            })
            .catch(() => {
              const errorMap = { ...get().toolCallsById }
              // Do not override terminal review/rejected
              if (
                isRejectedState(errorMap[id]?.state) ||
                isReviewState(errorMap[id]?.state) ||
                isBackgroundState(errorMap[id]?.state)
              ) {
                return
              }
              errorMap[id] = {
                ...errorMap[id],
                state: ClientToolCallState.error,
                display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
              }
              set({ toolCallsById: errorMap })
            })
        }, 0)
      }
    } catch {}
  },
  reasoning: (data, context, _get, set) => {
    const phase = (data && (data.phase || data?.data?.phase)) as string | undefined
    if (phase === 'start') {
      if (!context.currentThinkingBlock) {
        context.currentThinkingBlock = contentBlockPool.get()
        context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
        context.currentThinkingBlock.content = ''
        context.currentThinkingBlock.timestamp = Date.now()
        ;(context.currentThinkingBlock as any).startTime = Date.now()
        context.contentBlocks.push(context.currentThinkingBlock)
      }
      context.isInThinkingBlock = true
      context.currentTextBlock = null
      updateStreamingMessage(set, context)
      return
    }
    if (phase === 'end') {
      if (context.currentThinkingBlock) {
        ;(context.currentThinkingBlock as any).duration =
          Date.now() - ((context.currentThinkingBlock as any).startTime || Date.now())
      }
      context.isInThinkingBlock = false
      context.currentThinkingBlock = null
      context.currentTextBlock = null
      updateStreamingMessage(set, context)
      return
    }
    const chunk: string = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return
    if (context.currentThinkingBlock) {
      context.currentThinkingBlock.content += chunk
    } else {
      context.currentThinkingBlock = contentBlockPool.get()
      context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
      context.currentThinkingBlock.content = chunk
      context.currentThinkingBlock.timestamp = Date.now()
      ;(context.currentThinkingBlock as any).startTime = Date.now()
      context.contentBlocks.push(context.currentThinkingBlock)
    }
    context.isInThinkingBlock = true
    context.currentTextBlock = null
    updateStreamingMessage(set, context)
  },
  content: (data, context, _get, set) => {
    if (!data.data) return
    context.pendingContent += data.data

    let contentToProcess = context.pendingContent
    let hasProcessedContent = false

    const thinkingStartRegex = /<thinking>/
    const thinkingEndRegex = /<\/thinking>/

    while (contentToProcess.length > 0) {
      if (context.isInThinkingBlock) {
        const endMatch = thinkingEndRegex.exec(contentToProcess)
        if (endMatch) {
          const thinkingContent = contentToProcess.substring(0, endMatch.index)
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.content += thinkingContent
          } else {
            context.currentThinkingBlock = contentBlockPool.get()
            context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
            context.currentThinkingBlock.content = thinkingContent
            context.currentThinkingBlock.timestamp = Date.now()
            context.currentThinkingBlock.startTime = Date.now()
            context.contentBlocks.push(context.currentThinkingBlock)
          }
          context.isInThinkingBlock = false
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.duration =
              Date.now() - (context.currentThinkingBlock.startTime || Date.now())
          }
          context.currentThinkingBlock = null
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.content += contentToProcess
          } else {
            context.currentThinkingBlock = contentBlockPool.get()
            context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
            context.currentThinkingBlock.content = contentToProcess
            context.currentThinkingBlock.timestamp = Date.now()
            context.currentThinkingBlock.startTime = Date.now()
            context.contentBlocks.push(context.currentThinkingBlock)
          }
          contentToProcess = ''
          hasProcessedContent = true
        }
      } else {
        const startMatch = thinkingStartRegex.exec(contentToProcess)
        if (startMatch) {
          const textBeforeThinking = contentToProcess.substring(0, startMatch.index)
          if (textBeforeThinking) {
            context.accumulatedContent.append(textBeforeThinking)
            if (context.currentTextBlock && context.contentBlocks.length > 0) {
              const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
              if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
                lastBlock.content += textBeforeThinking
              } else {
                context.currentTextBlock = contentBlockPool.get()
                context.currentTextBlock.type = TEXT_BLOCK_TYPE
                context.currentTextBlock.content = textBeforeThinking
                context.currentTextBlock.timestamp = Date.now()
                context.contentBlocks.push(context.currentTextBlock)
              }
            } else {
              context.currentTextBlock = contentBlockPool.get()
              context.currentTextBlock.type = TEXT_BLOCK_TYPE
              context.currentTextBlock.content = textBeforeThinking
              context.currentTextBlock.timestamp = Date.now()
              context.contentBlocks.push(context.currentTextBlock)
            }
            hasProcessedContent = true
          }
          context.isInThinkingBlock = true
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(startMatch.index + startMatch[0].length)
          hasProcessedContent = true
        } else {
          const partialTagIndex = contentToProcess.lastIndexOf('<')
          let textToAdd = contentToProcess
          let remaining = ''
          if (partialTagIndex >= 0 && partialTagIndex > contentToProcess.length - 10) {
            textToAdd = contentToProcess.substring(0, partialTagIndex)
            remaining = contentToProcess.substring(partialTagIndex)
          }
          if (textToAdd) {
            context.accumulatedContent.append(textToAdd)
            if (context.currentTextBlock && context.contentBlocks.length > 0) {
              const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
              if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
                lastBlock.content += textToAdd
              } else {
                context.currentTextBlock = contentBlockPool.get()
                context.currentTextBlock.type = TEXT_BLOCK_TYPE
                context.currentTextBlock.content = textToAdd
                context.currentTextBlock.timestamp = Date.now()
                context.contentBlocks.push(context.currentTextBlock)
              }
            } else {
              context.currentTextBlock = contentBlockPool.get()
              context.currentTextBlock.type = TEXT_BLOCK_TYPE
              context.currentTextBlock.content = textToAdd
              context.currentTextBlock.timestamp = Date.now()
              context.contentBlocks.push(context.currentTextBlock)
            }
            hasProcessedContent = true
          }
          contentToProcess = remaining
          break
        }
      }
    }

    context.pendingContent = contentToProcess
    if (hasProcessedContent) {
      updateStreamingMessage(set, context)
    }
  },
  done: (_data, context) => {
    context.doneEventCount++
    if (context.doneEventCount >= 1) {
      context.streamComplete = true
    }
  },
  error: (data, context, _get, set) => {
    logger.error('Stream error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content: context.accumulatedContent || 'An error occurred.',
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },
  stream_end: (_data, context, _get, set) => {
    if (context.pendingContent) {
      if (context.isInThinkingBlock && context.currentThinkingBlock) {
        context.currentThinkingBlock.content += context.pendingContent
      } else if (context.pendingContent.trim()) {
        context.accumulatedContent.append(context.pendingContent)
        if (context.currentTextBlock && context.contentBlocks.length > 0) {
          const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
          if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
            lastBlock.content += context.pendingContent
          } else {
            context.currentTextBlock = contentBlockPool.get()
            context.currentTextBlock.type = TEXT_BLOCK_TYPE
            context.currentTextBlock.content = context.pendingContent
            context.currentTextBlock.timestamp = Date.now()
            context.contentBlocks.push(context.currentTextBlock)
          }
        } else {
          context.currentTextBlock = contentBlockPool.get()
          context.currentTextBlock.type = TEXT_BLOCK_TYPE
          context.currentTextBlock.content = context.pendingContent
          context.currentTextBlock.timestamp = Date.now()
          context.contentBlocks.push(context.currentTextBlock)
        }
      }
      context.pendingContent = ''
    }
    if (context.currentThinkingBlock) {
      context.currentThinkingBlock.duration =
        Date.now() - (context.currentThinkingBlock.startTime || Date.now())
    }
    context.isInThinkingBlock = false
    context.currentThinkingBlock = null
    context.currentTextBlock = null
    updateStreamingMessage(set, context)
  },
  default: () => {},
}

// Debounced UI update queue for smoother streaming
const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0
const MIN_BATCH_INTERVAL = 16
const MAX_BATCH_INTERVAL = 50
const MAX_QUEUE_SIZE = 5

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

function updateStreamingMessage(set: any, context: StreamingContext) {
  const now = performance.now()
  streamingUpdateQueue.set(context.messageId, context)
  const timeSinceLastBatch = now - lastBatchTime
  const shouldFlushImmediately =
    streamingUpdateQueue.size >= MAX_QUEUE_SIZE || timeSinceLastBatch > MAX_BATCH_INTERVAL

  if (streamingUpdateRAF === null) {
    const scheduleUpdate = () => {
      streamingUpdateRAF = requestAnimationFrame(() => {
        const updates = new Map(streamingUpdateQueue)
        streamingUpdateQueue.clear()
        streamingUpdateRAF = null
        lastBatchTime = performance.now()
        set((state: CopilotStore) => {
          if (updates.size === 0) return state
          const messages = state.messages
          const lastMessage = messages[messages.length - 1]
          const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
          if (updates.size === 1 && lastMessageUpdate) {
            const newMessages = [...messages]
            newMessages[messages.length - 1] = {
              ...lastMessage,
              content: '',
              contentBlocks:
                lastMessageUpdate.contentBlocks.length > 0
                  ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks)
                  : [],
            }
            return { messages: newMessages }
          }
          return {
            messages: messages.map((msg) => {
              const update = updates.get(msg.id)
              if (update) {
                return {
                  ...msg,
                  content: '',
                  contentBlocks:
                    update.contentBlocks.length > 0
                      ? createOptimizedContentBlocks(update.contentBlocks)
                      : [],
                }
              }
              return msg
            }),
          }
        })
      })
    }
    if (shouldFlushImmediately) scheduleUpdate()
    else setTimeout(scheduleUpdate, Math.max(0, MIN_BATCH_INTERVAL - timeSinceLastBatch))
  }
}

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
) {
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk
    const lastNewlineIndex = buffer.lastIndexOf('\n')
    if (lastNewlineIndex !== -1) {
      const linesToProcess = buffer.substring(0, lastNewlineIndex)
      buffer = buffer.substring(lastNewlineIndex + 1)
      const lines = linesToProcess.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.length === 0) continue
        if (line.charCodeAt(0) === 100 && line.startsWith(DATA_PREFIX)) {
          try {
            const jsonStr = line.substring(DATA_PREFIX_LENGTH)
            yield JSON.parse(jsonStr)
          } catch (error) {
            logger.warn('Failed to parse SSE data:', error)
          }
        }
      }
    }
  }
}

// Initial state (subset required for UI/streaming)
const initialState = {
  mode: 'agent' as const,
  agentDepth: 0 as 0 | 1 | 2 | 3,
  agentPrefetch: true,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  checkpoints: [] as any[],
  messageCheckpoints: {} as Record<string, any[]>,
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
  toolCallsById: {} as Record<string, CopilotToolCall>,
}

export const useCopilotStore = create<CopilotStore>()(
  devtools((set, get) => ({
    ...initialState,

    // Basic mode controls
    setMode: (mode) => set({ mode }),

    // Clear messages
    clearMessages: () => set({ messages: [] }),

    // Workflow selection
    setWorkflowId: async (workflowId: string | null) => {
      const currentWorkflowId = get().workflowId
      if (currentWorkflowId === workflowId) return
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort all in-progress tools and clear any diff preview
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}

      set({
        ...initialState,
        workflowId,
        mode: get().mode,
        agentDepth: get().agentDepth,
        agentPrefetch: get().agentPrefetch,
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
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}

      // Optimistically set selected chat and normalize messages for UI
      set({
        currentChat: chat,
        messages: normalizeMessagesForUI(chat.messages || []),
        planTodos: [],
        showPlanTodos: false,
      })

      // Refresh selected chat from server to ensure we have latest messages/tool calls
      try {
        const response = await fetch(`/api/copilot/chat?workflowId=${workflowId}`)
        if (!response.ok) throw new Error(`Failed to fetch latest chat data: ${response.status}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const latestChat = data.chats.find((c: CopilotChat) => c.id === chat.id)
          if (latestChat) {
            set({
              currentChat: latestChat,
              messages: normalizeMessagesForUI(latestChat.messages || []),
              chats: (get().chats || []).map((c: CopilotChat) =>
                c.id === chat.id ? latestChat : c
              ),
            })
            try {
              await get().loadMessageCheckpoints(latestChat.id)
            } catch {}
          }
        }
      } catch {}
    },

    createNewChat: async () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort in-progress tools and clear diff on new chat
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}

      set({
        currentChat: null,
        messages: [],
        messageCheckpoints: {},
        planTodos: [],
        showPlanTodos: false,
      })
    },

    deleteChat: async (_chatId: string) => {
      // no-op for now
    },

    areChatsFresh: (_workflowId: string) => false,

    loadChats: async (_forceRefresh = false) => {
      const { workflowId } = get()
      if (!workflowId) {
        set({ chats: [], isLoadingChats: false })
        return
      }

      // For now always fetch fresh
      set({ isLoadingChats: true })
      try {
        const response = await fetch(`/api/copilot/chat?workflowId=${workflowId}`)
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
            const { currentChat, isSendingMessage } = get()
            const currentChatStillExists =
              currentChat && data.chats.some((c: CopilotChat) => c.id === currentChat.id)

            if (currentChatStillExists) {
              const updatedCurrentChat = data.chats.find(
                (c: CopilotChat) => c.id === currentChat!.id
              )!
              if (isSendingMessage) {
                set({ currentChat: { ...updatedCurrentChat, messages: get().messages } })
              } else {
                set({
                  currentChat: updatedCurrentChat,
                  messages: normalizeMessagesForUI(updatedCurrentChat.messages || []),
                })
              }
              try {
                await get().loadMessageCheckpoints(updatedCurrentChat.id)
              } catch {}
            } else if (!isSendingMessage) {
              const mostRecentChat: CopilotChat = data.chats[0]
              set({
                currentChat: mostRecentChat,
                messages: normalizeMessagesForUI(mostRecentChat.messages || []),
              })
              try {
                await get().loadMessageCheckpoints(mostRecentChat.id)
              } catch {}
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
          error: error instanceof Error ? error.message : 'Failed to load chats',
        })
      }
    },

    // Send a message (streaming only)
    sendMessage: async (message: string, options = {}) => {
      const { workflowId, currentChat, mode, revertState } = get()
      const { stream = true, fileAttachments } = options as {
        stream?: boolean
        fileAttachments?: MessageFileAttachment[]
      }
      if (!workflowId) return

      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })

      const userMessage = createUserMessage(message, fileAttachments)
      const streamingMessage = createStreamingMessage()

      let newMessages: CopilotMessage[]
      if (revertState) {
        const currentMessages = get().messages
        newMessages = [...currentMessages, userMessage, streamingMessage]
        set({ revertState: null, inputValue: '' })
      } else {
        newMessages = [...get().messages, userMessage, streamingMessage]
      }

      const isFirstMessage = get().messages.length === 0 && !currentChat?.title
      set({ messages: newMessages })

      if (isFirstMessage) {
        const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message
        set((state) => ({
          currentChat: state.currentChat
            ? { ...state.currentChat, title: optimisticTitle }
            : state.currentChat,
        }))
      }

      try {
        const result = await sendStreamingMessage({
          message,
          userMessageId: userMessage.id,
          chatId: currentChat?.id,
          workflowId,
          mode: mode === 'ask' ? 'ask' : 'agent',
          depth: get().agentDepth,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream,
          fileAttachments,
          abortSignal: abortController.signal,
        })

        if (result.success && result.stream) {
          await get().handleStreamingResponse(result.stream, streamingMessage.id)
          set({ chatsLastLoadedAt: null, chatsLoadedForWorkflow: null })
        } else {
          if (result.error === 'Request was aborted') {
            return
          }

          // Check for specific status codes and provide custom messages
          let errorContent = result.error || 'Failed to send message'
          if (result.status === 401) {
            errorContent =
              '_Unauthorized request. You need a valid API key to use the copilot. You can get one by going to [sim.ai](https://sim.ai) settings and generating one there._'
          } else if (result.status === 402) {
            errorContent =
              '_Usage limit exceeded. To continue using this service, upgrade your plan or top up on credits._'
          }

          const errorMessage = createErrorMessage(streamingMessage.id, errorContent)
          set((state) => ({
            messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
            error: errorContent,
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          streamingMessage.id,
          'Sorry, I encountered an error while processing your message. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
          error: error instanceof Error ? error.message : 'Failed to send message',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Abort streaming
    abortMessage: () => {
      const { abortController, isSendingMessage, messages } = get()
      if (!isSendingMessage || !abortController) return
      set({ isAborting: true })
      try {
        abortController.abort()
        const lastMessage = messages[messages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
          const textContent =
            lastMessage.contentBlocks
              ?.filter((b) => b.type === 'text')
              .map((b: any) => b.content)
              .join('') || ''
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessage.id
                ? { ...msg, content: textContent.trim() || 'Message was aborted' }
                : msg
            ),
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
          }))
        } else {
          set({ isSendingMessage: false, isAborting: false, abortController: null })
        }

        // Immediately put all in-progress tools into aborted state
        abortAllInProgressTools(set, get)

        // Persist whatever contentBlocks/text we have to keep ordering for reloads
        const { currentChat } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: currentChat.id, messages: dbMessages }),
            }).catch(() => {})
          } catch {}
        }
      } catch {
        set({ isSendingMessage: false, isAborting: false, abortController: null })
      }
    },

    // Implicit feedback (send a continuation) - minimal
    sendImplicitFeedback: async (implicitFeedback: string) => {
      const { workflowId, currentChat, mode, agentDepth } = get()
      if (!workflowId) return
      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })
      const newAssistantMessage = createStreamingMessage()
      set((state) => ({ messages: [...state.messages, newAssistantMessage] }))
      try {
        const result = await sendStreamingMessage({
          message: 'Please continue your response.',
          chatId: currentChat?.id,
          workflowId,
          mode: mode === 'ask' ? 'ask' : 'agent',
          depth: agentDepth,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream: true,
          implicitFeedback,
          abortSignal: abortController.signal,
        })
        if (result.success && result.stream) {
          await get().handleStreamingResponse(result.stream, newAssistantMessage.id, false)
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
    setToolCallState: (toolCall: any, newState: any) => {
      try {
        const id: string | undefined = toolCall?.id
        if (!id) return
        const map = { ...get().toolCallsById }
        const current = map[id]
        if (!current) return
        // Preserve rejected state from being overridden
        if (
          isRejectedState(current.state) &&
          (newState === 'success' || newState === (ClientToolCallState as any).success)
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
        else if (typeof newState === 'number') norm = newState as unknown as ClientToolCallState
        map[id] = {
          ...current,
          state: norm,
          display: resolveToolDisplay(current.name, norm, id, current.params),
        }
        set({ toolCallsById: map })
      } catch {}
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
          const blocks = m.contentBlocks as any[]
          for (let bi = blocks.length - 1; bi >= 0; bi--) {
            const b = blocks[bi]
            if (b?.type === 'tool_call') {
              const tn = b.toolCall?.name
              if (tn === 'build_workflow' || tn === 'edit_workflow') {
                id = b.toolCall?.id
                break outer
              }
            }
          }
        }
        // Fallback to map if not found in messages
        if (!id) {
          const candidates = Object.values(toolCallsById).filter(
            (t) => t.name === 'build_workflow' || t.name === 'edit_workflow'
          )
          id = candidates.length ? candidates[candidates.length - 1].id : undefined
        }
      }
      if (!id) return
      const current = toolCallsById[id]
      if (!current) return
      // Do not override a rejected tool with success
      if (isRejectedState(current.state) && targetState === (ClientToolCallState as any).success) {
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
          const blocks = m.contentBlocks.map((b: any) => {
            if (b.type === 'tool_call' && b.toolCall?.id === id) {
              changed = true
              const prev = b.toolCall || {}
              return {
                ...b,
                toolCall: {
                  ...prev,
                  id,
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

      // Notify backend mark-complete to finalize tool server-side
      try {
        fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name: current.name,
            status:
              targetState === ClientToolCallState.success
                ? 200
                : targetState === ClientToolCallState.rejected
                  ? 409
                  : 500,
            message: toolCallState,
          }),
        }).catch(() => {})
      } catch {}
    },

    sendDocsMessage: async (query: string) => {
      await get().sendMessage(query)
    },

    saveChatMessages: async (_chatId: string) => {},

    loadCheckpoints: async (_chatId: string) => set({ checkpoints: [] }),

    loadMessageCheckpoints: async (chatId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isLoadingCheckpoints: true, checkpointError: null })
      try {
        const response = await fetch(`/api/copilot/checkpoints?chatId=${chatId}`)
        if (!response.ok) throw new Error(`Failed to load checkpoints: ${response.statusText}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.checkpoints)) {
          const grouped = data.checkpoints.reduce((acc: Record<string, any[]>, cp: any) => {
            const key = cp.messageId || '__no_message__'
            acc[key] = acc[key] || []
            acc[key].push(cp)
            return acc
          }, {})
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
        const response = await fetch('/api/copilot/checkpoints/revert', {
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
          // Apply to main workflow store
          useWorkflowStore.setState({
            blocks: reverted.blocks || {},
            edges: reverted.edges || [],
            loops: reverted.loops || {},
            parallels: reverted.parallels || {},
            lastSaved: reverted.lastSaved || Date.now(),
            isDeployed: !!reverted.isDeployed,
            ...(reverted.deployedAt ? { deployedAt: new Date(reverted.deployedAt) } : {}),
            deploymentStatuses: reverted.deploymentStatuses || {},
            hasActiveWebhook: !!reverted.hasActiveWebhook,
          })

          // Extract and apply subblock values
          const values: Record<string, Record<string, any>> = {}
          Object.entries(reverted.blocks || {}).forEach(([blockId, block]: [string, any]) => {
            values[blockId] = {}
            Object.entries((block as any).subBlocks || {}).forEach(
              ([subId, sub]: [string, any]) => {
                values[blockId][subId] = (sub as any)?.value
              }
            )
          })
          const subState = useSubBlockStore.getState()
          useSubBlockStore.setState({
            workflowValues: {
              ...subState.workflowValues,
              [workflowId]: values,
            },
          })
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
      return messageCheckpoints[messageId] || []
    },

    // Preview YAML (stubbed/no-op)
    setPreviewYaml: async (_yamlContent: string) => {},
    clearPreviewYaml: async () => {
      set((state) => ({
        currentChat: state.currentChat ? { ...state.currentChat, previewYaml: null } : null,
      }))
    },

    // Handle streaming response
    handleStreamingResponse: async (
      stream: ReadableStream,
      messageId: string,
      isContinuation = false
    ) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()

      const context: StreamingContext = {
        messageId,
        accumulatedContent: new StringBuilder(),
        contentBlocks: [],
        currentTextBlock: null,
        isInThinkingBlock: false,
        currentThinkingBlock: null,
        pendingContent: '',
        doneEventCount: 0,
      }

      if (isContinuation) {
        const { messages } = get()
        const existingMessage = messages.find((m) => m.id === messageId)
        if (existingMessage) {
          if (existingMessage.content) context.accumulatedContent.append(existingMessage.content)
          context.contentBlocks = existingMessage.contentBlocks
            ? [...existingMessage.contentBlocks]
            : []
        }
      }

      const timeoutId = setTimeout(() => {
        logger.warn('Stream timeout reached, completing response')
        reader.cancel()
      }, 600000)

      try {
        for await (const data of parseSSEStream(reader, decoder)) {
          const { abortController } = get()
          if (abortController?.signal.aborted) break
          const handler = sseHandlers[data.type] || sseHandlers.default
          await handler(data, context, get, set)
          if (context.streamComplete) break
        }

        if (sseHandlers.stream_end) sseHandlers.stream_end({}, context, get, set)

        if (streamingUpdateRAF !== null) {
          cancelAnimationFrame(streamingUpdateRAF)
          streamingUpdateRAF = null
        }
        streamingUpdateQueue.clear()

        if (context.contentBlocks) {
          context.contentBlocks.forEach((block) => {
            if (block.type === TEXT_BLOCK_TYPE || block.type === THINKING_BLOCK_TYPE) {
              contentBlockPool.release(block)
            }
          })
        }

        const finalContent = context.accumulatedContent.toString()
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: finalContent,
                  contentBlocks: context.contentBlocks,
                }
              : msg
          ),
          isSendingMessage: false,
          abortController: null,
        }))

        if (context.newChatId && !get().currentChat) {
          await get().handleNewChatCreation(context.newChatId)
        }

        // Persist full message state (including contentBlocks) to database
        const { currentChat } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: currentChat.id, messages: dbMessages }),
            })
          } catch {}
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },

    // Handle new chat creation from stream
    handleNewChatCreation: async (newChatId: string) => {
      const newChat: CopilotChat = {
        id: newChatId,
        title: null,
        model: 'gpt-4',
        messages: get().messages,
        messageCount: get().messages.length,
        previewYaml: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      // Abort any in-progress tools and clear diff on new chat creation
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}

      set({
        currentChat: newChat,
        chats: [newChat, ...(get().chats || [])],
        chatsLastLoadedAt: null,
        chatsLoadedForWorkflow: null,
        planTodos: [],
        showPlanTodos: false,
      })
    },

    // Utilities
    clearError: () => set({ error: null }),
    clearSaveError: () => set({ saveError: null }),
    clearCheckpointError: () => set({ checkpointError: null }),
    retrySave: async (_chatId: string) => {},

    cleanup: () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      if (streamingUpdateRAF !== null) {
        cancelAnimationFrame(streamingUpdateRAF)
        streamingUpdateRAF = null
      }
      streamingUpdateQueue.clear()
      // Clear any diff on cleanup
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}
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

    // Diff updates are out of scope for minimal store
    updateDiffStore: async (_yamlContent: string) => {},
    updateDiffStoreWithWorkflowState: async (_workflowState: any) => {},

    setAgentDepth: (depth) => set({ agentDepth: depth }),
    setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),
  }))
)

// Sync class-based tool instance state changes back into the store map
try {
  registerToolStateSync((toolCallId: string, nextState: any) => {
    const state = useCopilotStore.getState()
    const current = state.toolCallsById[toolCallId]
    if (!current) return
    let mapped: ClientToolCallState = current.state
    if (nextState === 'executing') mapped = ClientToolCallState.executing
    else if (nextState === 'pending') mapped = ClientToolCallState.pending
    else if (nextState === 'success' || nextState === 'accepted')
      mapped = ClientToolCallState.success
    else if (nextState === 'error' || nextState === 'errored') mapped = ClientToolCallState.error
    else if (nextState === 'rejected') mapped = ClientToolCallState.rejected
    else if (nextState === 'aborted') mapped = ClientToolCallState.aborted
    else if (nextState === 'review') mapped = (ClientToolCallState as any).review
    else if (nextState === 'background') mapped = (ClientToolCallState as any).background
    else if (typeof nextState === 'number') mapped = nextState as unknown as ClientToolCallState

    // Store-authoritative gating: ignore invalid/downgrade transitions
    const isTerminal = (s: ClientToolCallState) =>
      s === ClientToolCallState.success ||
      s === ClientToolCallState.error ||
      s === ClientToolCallState.rejected ||
      s === ClientToolCallState.aborted ||
      (s as any) === (ClientToolCallState as any).review ||
      (s as any) === (ClientToolCallState as any).background

    // If we've already reached a terminal state, ignore any further non-terminal updates
    if (isTerminal(current.state) && !isTerminal(mapped)) {
      return
    }
    // Prevent downgrades (executing → pending, pending → generating)
    if (
      (current.state === ClientToolCallState.executing && mapped === ClientToolCallState.pending) ||
      (current.state === ClientToolCallState.pending &&
        mapped === (ClientToolCallState as any).generating)
    ) {
      return
    }
    // No-op if unchanged
    if (mapped === current.state) return
    const updated = {
      ...state.toolCallsById,
      [toolCallId]: {
        ...current,
        state: mapped,
        display: resolveToolDisplay(current.name, mapped, toolCallId, current.params),
      },
    }
    useCopilotStore.setState({ toolCallsById: updated })
  })
} catch {}
