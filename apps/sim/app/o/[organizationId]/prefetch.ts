import type { SessionPrincipal } from '@sim/auth/principal'
import type { QueryClient } from '@tanstack/react-query'
import { listOrganizationChats } from '@/lib/copilot/chat/organization-chats'
import { prefetchUserProfile } from '@/lib/users/prefetch-user-profile'
import { seedWorkspaceList } from '@/lib/workspaces/seed-workspace-list'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'

/**
 * Settles the org sidebar's reads before hydration, using the client keys and
 * mappers. Chat access goes through the same authorized operation as the API;
 * failed reads stay out of hydration so the client can retry them.
 */
export async function prefetchOrganizationSidebar(
  queryClient: QueryClient,
  organizationId: string,
  principal: SessionPrincipal,
  activeOrganizationId: string | null
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: mothershipChatKeys.organizationList(organizationId, 'active'),
      queryFn: async () => {
        const chats = await listOrganizationChats.execute({
          principal,
          input: { organizationId, scope: 'active' },
        })
        return chats.map(mapChat)
      },
      staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
    }),
    seedWorkspaceList(queryClient, principal.userId, activeOrganizationId),
    prefetchUserProfile(queryClient, principal.userId),
  ])
}
