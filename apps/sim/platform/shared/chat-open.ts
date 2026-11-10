interface ChatOpenAccess {
  mothershipAvailable: boolean
  searchAccess: { memberScoped: boolean }
}

/**
 * Whether the chat routes would open a chat of this mode for the viewer. Nothing opens without chat
 * access, an Assistant chat needs member-scoped Search, and a Plan chat is refused once Plan is off,
 * so none of those should be offered. A chat with no mode is an optimistic entry the viewer just
 * started.
 */
export function canOpenOrganizationChat(
  { mothershipAvailable, searchAccess }: ChatOpenAccess,
  planEnabled: boolean,
  mode: string | undefined
): boolean {
  if (!mothershipAvailable) return false
  if (mode === 'assistant') return searchAccess.memberScoped
  if (mode === 'plan') return planEnabled
  return true
}
