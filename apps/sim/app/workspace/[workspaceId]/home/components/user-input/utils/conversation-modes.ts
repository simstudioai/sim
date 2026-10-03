const CONVERSATION_MODES = [
  { value: 'assistant', label: 'Search' },
  { value: 'agent', label: 'Build' },
  { value: 'plan', label: 'Plan' },
] as const

export function getConversationModes(searchEnabled: boolean, planEnabled: boolean) {
  return CONVERSATION_MODES.filter(
    ({ value }) => value === 'agent' || (value === 'assistant' ? searchEnabled : planEnabled)
  )
}
