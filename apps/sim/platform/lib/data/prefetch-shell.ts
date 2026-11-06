import 'server-only'
import { createLogger } from '@sim/logger'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listMothershipChatsContract } from '@/lib/api/contracts/mothership-chats'
import { getUserProfileContract, getUserSettingsContract } from '@/lib/api/contracts/user'
import { listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
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
import { normalizeWorkspacesResponse } from '@/hooks/queries/utils/workspace-list-query'
import { workspaceKeys } from '@/hooks/queries/workspace'
import {
  canListOrganizationChats,
  type PlatformOrganization,
} from '@/platform/lib/data/organization-model'
import { prefetchRequestJson } from '@/platform/lib/data/server-request'

const logger = createLogger('PlatformShellPrefetch')

/**
 * The legacy sidebar's reads for first paint, under the client hooks' keys and mappers. A failed
 * read is never dehydrated, so the client retries it. An empty workspace list stays uncached for
 * the same reason as the legacy seed: the client's own read reaches the default-workspace path.
 */
export async function prefetchShell(organization: PlatformOrganization): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await Promise.all([
    canListOrganizationChats(organization) &&
      queryClient.prefetchQuery({
        queryKey: mothershipChatKeys.organizationList(organization.organization.id, 'active'),
        queryFn: async () => {
          const { data } = await prefetchRequestJson(listMothershipChatsContract, {
            query: { organizationId: organization.organization.id, scope: 'active' },
          })
          return data.map(mapChat)
        },
        staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
      }),
    prefetchRequestJson(listWorkspacesContract, {
      query: { scope: 'active' },
    }).then(
      (payload) => {
        if (payload.workspaces.length === 0) return
        queryClient.setQueryData(workspaceKeys.list('active'), normalizeWorkspacesResponse(payload))
      },
      (error: unknown) =>
        logger.warn('Workspace list prefetch failed; client will fetch', { error })
    ),
    queryClient.prefetchQuery({
      queryKey: userProfileKeys.profile(),
      queryFn: async () => {
        const { user } = await prefetchRequestJson(getUserProfileContract, {})
        return mapUserProfileResponse(user)
      },
      staleTime: USER_PROFILE_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: generalSettingsKeys.settings(),
      queryFn: async () => {
        const { data } = await prefetchRequestJson(getUserSettingsContract, {})
        return mapGeneralSettingsResponse(data)
      },
      staleTime: GENERAL_SETTINGS_STALE_TIME,
    }),
  ])
  return dehydrate(queryClient)
}
