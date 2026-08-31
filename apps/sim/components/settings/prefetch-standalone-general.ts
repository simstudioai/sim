import type { QueryClient } from '@tanstack/react-query'
import { getUserProfileContract, getUserSettingsContract } from '@/lib/api/contracts/user'
import { internalSessionAuth } from '@/lib/api/server/routes'
import {
  getCurrentUserProfileUseCase,
  getCurrentUserSettingsUseCase,
} from '@/lib/users/application/read-current-user'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/general-settings'
import {
  mapUserProfileResponse,
  USER_PROFILE_STALE_TIME,
  userProfileKeys,
} from '@/hooks/queries/user-profile'

/**
 * Hydrates the authenticated viewer's standalone General page with the exact
 * keys, values, and freshness windows consumed by its client queries.
 */
export async function prefetchStandaloneGeneral(queryClient: QueryClient): Promise<void> {
  let principalPromise: ReturnType<typeof internalSessionAuth.authenticate> | undefined
  const getPrincipal = () => {
    principalPromise ??= internalSessionAuth.authenticate()
    return principalPromise
  }

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: userProfileKeys.profile(),
      queryFn: async () => {
        const profile = await getCurrentUserProfileUseCase.execute({
          principal: await getPrincipal(),
          input: {},
        })
        const response = getUserProfileContract.response.schema.parse({ user: profile })
        return mapUserProfileResponse(response.user)
      },
      staleTime: USER_PROFILE_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: generalSettingsKeys.settings(),
      queryFn: async () => {
        const settings = await getCurrentUserSettingsUseCase.execute({
          principal: await getPrincipal(),
          input: {},
        })
        const response = getUserSettingsContract.response.schema.parse({ data: settings })
        return mapGeneralSettingsResponse(response.data)
      },
      staleTime: GENERAL_SETTINGS_STALE_TIME,
    }),
  ])
}
