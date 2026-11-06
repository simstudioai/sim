import type { OrganizationChatAccess } from '@/lib/organizations/chat-access'

/**
 * Whether the chat routes would open a chat of this mode for the viewer. An agent or Plan chat is
 * refused to a viewer who can no longer build, and a Plan chat once Plan is off, so neither should be
 * offered. A chat with no mode is an optimistic entry the viewer just started.
 */
export function canOpenOrganizationChat(
  {
    mothershipAvailable,
    canBuild,
    searchAccess,
  }: Pick<OrganizationChatAccess, 'mothershipAvailable' | 'canBuild'> & {
    searchAccess: Pick<OrganizationChatAccess['searchAccess'], 'memberScoped'>
  },
  planEnabled: boolean,
  mode: string | undefined
): boolean {
  if (!mothershipAvailable) return false
  if (mode === 'assistant') return searchAccess.memberScoped
  if (mode === 'plan') return canBuild && planEnabled
  return mode === 'agent' ? canBuild : canBuild || searchAccess.memberScoped
}
