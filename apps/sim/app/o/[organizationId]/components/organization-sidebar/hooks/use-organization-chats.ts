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

/** Stable identity for the empty list, so the section's memos don't churn. */
const EMPTY_CHATS: OrganizationChat[] = []

/**
 * Chats listed in the organization sidebar. The organization surface has no chat
 * source of its own, so the list is empty and never loading.
 */
export function useOrganizationChats(_organizationId: string) {
  return { chats: EMPTY_CHATS, isLoading: false }
}
