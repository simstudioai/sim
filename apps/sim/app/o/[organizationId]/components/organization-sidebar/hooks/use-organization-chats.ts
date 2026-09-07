import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'

export interface OrganizationChat {
  id: string
  name: string
  href: string
  /** A run is in progress. */
  isActive?: boolean
  /** Has a reply the viewer has not opened. */
  isUnread?: boolean
  isPinned?: boolean
}

/** Lists only the current member's private organization conversations. */
export function useOrganizationChats(organizationId: string) {
  const query = useOrganizationMothershipChats(organizationId)
  const chats: OrganizationChat[] = (query.data ?? []).map((chat) => ({
    id: chat.id,
    name: chat.name,
    href: `/o/${organizationId}/chat/${chat.id}`,
    isActive: chat.isActive,
    isUnread: chat.isUnread,
    isPinned: chat.isPinned,
  }))
  return { chats, isLoading: query.isPending }
}
