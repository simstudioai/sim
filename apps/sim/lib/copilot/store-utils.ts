import { Loader2 } from 'lucide-react'
import {
  ClientToolCallState,
  type ClientToolDisplay,
  TOOL_DISPLAY_REGISTRY,
} from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore } from '@/stores/panel/copilot/types'

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  _toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  if (!toolName) return undefined
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

export function abortAllInProgressTools(
  set: any,
  get: () => CopilotStore
) {
  try {
    const { toolCallsById, messages } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds = new Set<string>()
    let hasUpdates = false
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
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
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
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

export function stripTodoTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<marktodo>[\s\S]*?<\/marktodo>/g, '')
    .replace(/<checkofftodo>[\s\S]*?<\/checkofftodo>/g, '')
    .replace(/<design_workflow>[\s\S]*?<\/design_workflow>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
}
