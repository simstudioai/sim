export const DEFAULT_AGENT_HISTORY_TOKENS = 16_000
export const AGENT_CONTEXT_UTILIZATION = 0.9

export interface ConversationContextGroup<T> {
  value: T
  tokens: number
  required?: boolean
  summary?: boolean
}

export interface ConversationContextBudget {
  contextWindow: number
  fixedTokens: number
  outputTokens: number
  historyTokens?: number
}

/** A malformed request must not become a reason to regenerate completed tool decisions. */
export class AgentContextLimitError extends Error {
  readonly retryable = false

  constructor() {
    super('The Agent context budget contains an invalid token limit or estimate.')
    this.name = 'AgentContextLimitError'
  }
}

/**
 * Estimates bound optional history only; required current context remains intact for the provider.
 * Adapters own grouping and token costs.
 */
export function getConversationHistoryTokenBudget<T>(
  groups: readonly ConversationContextGroup<T>[],
  options: ConversationContextBudget
): number {
  const { contextWindow, fixedTokens, outputTokens } = options
  const historyTokens = options.historyTokens ?? DEFAULT_AGENT_HISTORY_TOKENS
  if (
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0 ||
    !Number.isFinite(fixedTokens) ||
    fixedTokens < 0 ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    !Number.isFinite(historyTokens) ||
    historyTokens < 0
  ) {
    throw new AgentContextLimitError()
  }

  let available = Math.floor(contextWindow * AGENT_CONTEXT_UTILIZATION) - fixedTokens - outputTokens
  for (const group of groups) {
    if (!group.required) continue
    if (!Number.isFinite(group.tokens) || group.tokens < 0) throw new AgentContextLimitError()
    available -= Math.ceil(group.tokens)
  }
  if (!Number.isFinite(available)) throw new AgentContextLimitError()

  return Math.min(Math.max(0, available), Math.floor(historyTokens))
}

/** Bounded summaries take priority within the same optional budget as the recent raw suffix. */
export function selectConversationContextGroups<T>(
  groups: readonly ConversationContextGroup<T>[],
  options: ConversationContextBudget
): T[] {
  let remaining = getConversationHistoryTokenBudget(groups, options)
  const selected = new Set<number>()
  for (const [index, group] of groups.entries()) {
    if (group.required) selected.add(index)
  }
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    if (!group.summary || selected.has(index)) continue
    if (!Number.isFinite(group.tokens) || group.tokens < 0 || Math.ceil(group.tokens) > remaining)
      continue
    selected.add(index)
    remaining -= Math.ceil(group.tokens)
  }
  for (let index = groups.length - 1; index >= 0; index--) {
    if (selected.has(index) || groups[index].summary) continue
    const tokens = groups[index].tokens
    if (!Number.isFinite(tokens) || tokens < 0 || Math.ceil(tokens) > remaining) break
    selected.add(index)
    remaining -= Math.ceil(tokens)
  }
  return groups.filter((_, index) => selected.has(index)).map((group) => group.value)
}
