import 'server-only'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
import { listMothershipChatsContract } from '@/lib/api/contracts/mothership-chats'
import { getUserProfileContract } from '@/lib/api/contracts/user'
import { getSession } from '@/lib/auth'
import { toAppSession } from '@/lib/auth/session-response'
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
import { sessionKeys } from '@/hooks/queries/utils/session-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  asRouteResponse,
  readSessionViewer,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'
import { readShellOrganizationId } from '@/platform/lib/data/shell-scope'

const logger = createLogger('ShellPrefetch')

/** The shell's first-paint reads, started before its organization gate and finished after it. */
interface ShellPrefetch {
  /**
   * Adds the reads that need the gated organization (the chat list, and the workspace list when
   * the gate settled on another organization than the shell named) and dehydrates them all.
   */
  finish(organization: PlatformOrganization): Promise<DehydratedState>
}

/**
 * The legacy sidebar's reads for first paint, under the client hooks' keys and mappers. A failed
 * read is never dehydrated, so the client retries it. The workspace list is always seeded, with the
 * viewer's default workspace created first, in the shell's organization, when they have none. The
 * session query is seeded from the session this request already read, cut to the fields the
 * browser may hold, so first paint makes no `get-session` request of its own.
 *
 * Called before the organization surface is read: the session, profile, settings and the shell
 * organization's workspace list need only the viewer, so they run alongside the gate; only the chat
 * list waits for it, since the surface decides whether chat is available.
 */
export function startShellPrefetch(): ShellPrefetch {
  const queryClient = makeQueryClient()
  const viewerReads = prefetchViewerReads(queryClient).catch((error: unknown) => {
    logger.warn('Shell prefetch could not start before the organization gate', {
      error: getErrorMessage(error),
    })
    return undefined
  })
  return {
    async finish(organization) {
      const { principal } = await requireSessionViewer()
      const organizationId = organization.organization.id
      const seededOrganizationId = await viewerReads
      await Promise.all([
        organization.mothershipAvailable &&
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
        seededOrganizationId !== organizationId &&
          seedWorkspaceList(queryClient, { principal, organizationId }, withinPrefetchBudget),
      ])
      return dehydrate(queryClient)
    },
  }
}

/**
 * The reads that need only the signed-in viewer. Resolves to the organization whose workspace list
 * it seeded, which is the one the shell's surface reads, or `undefined` for a signed-out request.
 */
async function prefetchViewerReads(queryClient: QueryClient): Promise<string | undefined> {
  const viewer = await readSessionViewer()
  if (!viewer) return undefined
  const { principal } = viewer
  const [, , , organizationId] = await Promise.all([
    getSession().then((session) => {
      const appSession = toAppSession(session)
      if (appSession) queryClient.setQueryData(sessionKeys.detail(), appSession)
    }),
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
    readShellOrganizationId().then(async (shellOrganizationId) => {
      if (!shellOrganizationId) return undefined
      await seedWorkspaceList(
        queryClient,
        { principal, organizationId: shellOrganizationId },
        withinPrefetchBudget
      )
      return shellOrganizationId
    }),
  ])
  return organizationId
}
