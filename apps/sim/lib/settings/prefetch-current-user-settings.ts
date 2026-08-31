import type { QueryClient } from '@tanstack/react-query'
import { getUserSettingsContract } from '@/lib/api/contracts/user'
import { internalSessionAuth } from '@/lib/api/server/routes/internal-json-route'
import { getCurrentUserSettingsUseCase } from '@/lib/users/application/read-current-user'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/current-user-data'

type GetPrincipal = () => ReturnType<typeof internalSessionAuth.authenticate>

export function prefetchCurrentUserSettings(
  queryClient: QueryClient,
  getPrincipal: GetPrincipal = () => internalSessionAuth.authenticate()
) {
  return queryClient.prefetchQuery({
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
  })
}
