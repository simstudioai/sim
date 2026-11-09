import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listMothershipChatsContract } from '@/lib/api/contracts/mothership-chats'
import { getUserProfileContract } from '@/lib/api/contracts/user'
import { listOrganizationChats } from '@/lib/mothership/chat/organization-chats'
import { prefetchCurrentUserSettings } from '@/lib/settings/prefetch-current-user-settings'
import { getCurrentUserProfileUseCase } from '@/lib/users/application/read-current-user'
import { seedWorkspaceList } from '@/lib/workspaces/seed-workspace-list'
import {
  mapUserProfileResponse,
  USER_PROFILE_STALE_TIME,
  userProfileKeys,
} from '@/hooks/queries/current-user-data'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  canListOrganizationChats,
  type PlatformOrganization,
} from '@/platform/lib/data/organization-model'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/**
 * The legacy sidebar's reads for first paint, under the client hooks' keys and mappers. A failed
 * read is never dehydrated, so the client retries it. An empty workspace list stays uncached for
 * the same reason as the legacy seed: the client's own read reaches the default-workspace path.
 */
export async function prefetchShell(organization: PlatformOrganization): Promise<DehydratedState> {
  const { principal, activeOrganizationId } = await requireSessionViewer()
  const organizationId = organization.organization.id
  const queryClient = makeQueryClient()
  await Promise.all([
    canListOrganizationChats(organization) &&
      queryClient.prefetchQuery({
        queryKey: mothershipChatKeys.organizationList(organizationId, 'active'),
        queryFn: () =>
          withinPrefetchBudget(async () => {
            const { data } = await asRouteResponse(listMothershipChatsContract, {
              success: true,
              data: await listOrganizationChats.execute({
                principal,
                input: { organizationId, scope: 'active' },
              }),
            })
            return data.map(mapChat)
          }),
        staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
      }),
    seedWorkspaceList(queryClient, principal.userId, activeOrganizationId),
    queryClient.prefetchQuery({
      queryKey: userProfileKeys.profile(),
      queryFn: () =>
        withinPrefetchBudget(async () => {
          const { user } = await asRouteResponse(getUserProfileContract, {
            user: await getCurrentUserProfileUseCase.execute({ principal, input: {} }),
          })
          return mapUserProfileResponse(user)
        }),
      staleTime: USER_PROFILE_STALE_TIME,
    }),
    prefetchCurrentUserSettings(queryClient, async () => principal),
  ])
  return dehydrate(queryClient)
}
