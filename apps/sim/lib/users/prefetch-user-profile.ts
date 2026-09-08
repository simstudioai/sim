import type { QueryClient } from '@tanstack/react-query'
import { getUserProfile } from '@/lib/users/queries'
import {
  mapUserProfileResponse,
  USER_PROFILE_STALE_TIME,
  userProfileKeys,
} from '@/hooks/queries/current-user-data'

/**
 * Seeds the viewer's profile query for a surface whose chrome renders it — the
 * sidebar footer's name and avatar. Keyed identically to `useUserProfile`, so the
 * footer paints hydrated, and so a page beneath that hydrates the same key finds
 * the query already populated rather than an empty one it cannot fill during
 * render. Needs no session lookup: the caller already resolved the viewer.
 */
export async function prefetchUserProfile(queryClient: QueryClient, userId: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: userProfileKeys.profile(),
    queryFn: async () => {
      const user = await getUserProfile(userId)
      if (!user) throw new Error('User not found')
      return mapUserProfileResponse(user)
    },
    staleTime: USER_PROFILE_STALE_TIME,
  })
}
