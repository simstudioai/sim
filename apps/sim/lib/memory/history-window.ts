import { MEMORY } from '@/lib/memory/constants'
import { getConversationTokenCount } from '@/lib/memory/context-tokens'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import type { Message } from '@/providers/types'

const exchangeGroups = new WeakSet<object>()

export function markConversationExchangeGroup(group: readonly Message[]): void {
  exchangeGroups.add(group)
}

/** Internal exchanges consume no additional conversational-message slots. */
export function selectConversationMessageWindow<T extends Message>(
  messages: T[],
  limit: number,
  groups?: T[][]
): T[] {
  if (!groups) return messages.slice(-limit)
  const selected: T[][] = []
  let count = 0
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    const slots =
      exchangeGroups.has(group) ||
      group.some((message) => message.tool_calls?.length || message.role === 'tool')
        ? 0
        : group.length
    if (selected.length > 0 && count + slots > limit) break
    selected.unshift(group)
    count += slots
    if (count >= limit) break
  }
  return selected.flat()
}

/** Selects an intact suffix; request adapters additionally budget schemas, files, and output reserve. */
export function selectConversationTokenWindow<T extends Message>(
  messages: T[],
  maxTokens: number,
  model?: string,
  groups?: T[][]
): T[] {
  const selected: T[][] = []
  let tokenCount = 0
  const historyGroups = groups ?? messages.map((message) => [message])
  for (let index = historyGroups.length - 1; index >= 0; index--) {
    const group = historyGroups[index]
    const tokens = group.reduce(
      (total, message) =>
        total +
        getConversationTokenCount(
          groups
            ? JSON.stringify({
                role: message.role,
                content: message.content,
                tool_calls: message.tool_calls,
                tool_call_id: message.tool_call_id,
                name: message.name,
              })
            : (message.content ?? ''),
          model
        ),
      0
    )
    if (selected.length > 0 && tokenCount + tokens > maxTokens) break
    selected.unshift(group)
    tokenCount += tokens
    if (tokenCount >= maxTokens) break
  }
  return selected.flat()
}

export function selectConversationContextWindow<T extends Message>(
  messages: T[],
  model?: string,
  groups?: T[][]
): T[] {
  if (!model) return messages
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    if (provider.contextInformationAvailable === false) continue
    const definition = provider.models.find((candidate) => candidate.id === model)
    if (definition?.contextWindow)
      return selectConversationTokenWindow(
        messages,
        Math.floor(definition.contextWindow * MEMORY.CONTEXT_WINDOW_UTILIZATION),
        model,
        groups
      )
  }
  return messages
}
