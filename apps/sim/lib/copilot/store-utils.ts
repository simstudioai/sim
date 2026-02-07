import { createLogger } from '@sim/logger'
import { Loader2 } from 'lucide-react'
import {
  ClientToolCallState,
  type ClientToolDisplay,
  TOOL_DISPLAY_REGISTRY,
} from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore } from '@/stores/panel/copilot/types'

const logger = createLogger('CopilotStoreUtils')

type StoreSet = (
  partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)
) => void

/** Respond tools are internal to copilot subagents and should never be shown in the UI */
const HIDDEN_TOOL_SUFFIX = '_respond'

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  _toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  if (!toolName) return undefined
  if (toolName.endsWith(HIDDEN_TOOL_SUFFIX)) return undefined
  const entry = TOOL_DISPLAY_REGISTRY[toolName]
  if (!entry) return humanizedFallback(toolName, state)

  if (entry.uiConfig?.dynamicText && params) {
    const dynamicText = entry.uiConfig.dynamicText(params, state)
    const stateDisplay = entry.displayNames[state]
    if (dynamicText && stateDisplay?.icon) {
      return { text: dynamicText, icon: stateDisplay.icon }
    }
  }

  const display = entry.displayNames[state]
  if (display?.text || display?.icon) return display

  const fallbackOrder = [
    ClientToolCallState.generating,
    ClientToolCallState.executing,
    ClientToolCallState.success,
  ]
  for (const fallbackState of fallbackOrder) {
    const fallback = entry.displayNames[fallbackState]
    if (fallback?.text || fallback?.icon) return fallback
  }

  return humanizedFallback(toolName, state)
}

export function humanizedFallback(
  toolName: string,
  state: ClientToolCallState
): ClientToolDisplay | undefined {
  const formattedName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const stateVerb =
    state === ClientToolCallState.success
      ? 'Executed'
      : state === ClientToolCallState.error
        ? 'Failed'
        : state === ClientToolCallState.rejected || state === ClientToolCallState.aborted
          ? 'Skipped'
          : 'Executing'
  return { text: `${stateVerb} ${formattedName}`, icon: Loader2 }
}

export function isRejectedState(state: string): boolean {
  return state === 'rejected'
}

export function isReviewState(state: string): boolean {
  return state === 'review'
}

export function isBackgroundState(state: string): boolean {
  return state === 'background'
}

export function isTerminalState(state: string): boolean {
  return (
    state === ClientToolCallState.success ||
    state === ClientToolCallState.error ||
    state === ClientToolCallState.rejected ||
    state === ClientToolCallState.aborted ||
    isReviewState(state) ||
    isBackgroundState(state)
  )
}

export function abortAllInProgressTools(set: StoreSet, get: () => CopilotStore) {
  try {
    const { toolCallsById, messages } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds = new Set<string>()
    let hasUpdates = false
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state
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
          subAgentStreaming: false,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, tc.params),
        }
        hasUpdates = true
      } else if (tc.subAgentStreaming) {
        updatedMap[id] = {
          ...tc,
          subAgentStreaming: false,
        }
        hasUpdates = true
      }
    }
    if (abortedIds.size > 0 || hasUpdates) {
      set({ toolCallsById: updatedMap })
      set((s: CopilotStore) => {
        const msgs = [...s.messages]
        for (let mi = msgs.length - 1; mi >= 0; mi--) {
          const m = msgs[mi]
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
  } catch (error) {
    logger.warn('Failed to abort in-progress tools', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function cleanupActiveState(
  set: (partial: Record<string, unknown>) => void,
  get: () => Record<string, unknown>
): void {
  abortAllInProgressTools(set as unknown as StoreSet, get as unknown as () => CopilotStore)
  try {
    const { useWorkflowDiffStore } = require('@/stores/workflow-diff/store') as {
      useWorkflowDiffStore: {
        getState: () => { clearDiff: (options?: { restoreBaseline?: boolean }) => void }
      }
    }
    useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })
  } catch (error) {
    logger.warn('Failed to clear diff during cleanup', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function stripTodoTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<marktodo>[\s\S]*?<\/marktodo>/g, '')
    .replace(/<checkofftodo>[\s\S]*?<\/checkofftodo>/g, '')
    .replace(/<design_workflow>[\s\S]*?<\/design_workflow>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
}
