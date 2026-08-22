import type { QueryClient } from '@tanstack/react-query'
import { listCredentialGroupsContract } from '@/lib/api/contracts/credential-groups'
import { internalSessionAuth } from '@/lib/api/server/routes/internal-json-route'
import { listCredentialGroupSettings } from '@/lib/credential-groups/application/manage-groups'
import { getUserSettings } from '@/lib/users/queries'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/general-settings'
import {
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
} from '@/hooks/queries/utils/credential-group-queries'

/** Prefetches the same key and mapped value as `useGeneralSettings`. */
export function prefetchGeneralSettings(queryClient: QueryClient, userId: string) {
  return queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const data = await getUserSettings(userId)
      return mapGeneralSettingsResponse(data)
    },
    staleTime: GENERAL_SETTINGS_STALE_TIME,
  })
}

/** Prefetches credential groups through the route's authorization and response boundaries. */
async function prefetchCredentialGroups(
  queryClient: QueryClient,
  { workspaceId }: SettingsSectionPrefetchContext
) {
  return queryClient.prefetchQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: async () => {
      const principal = await internalSessionAuth.authenticate()
      const result = await listCredentialGroupSettings.execute({
        principal,
        input: { workspaceId },
      })
      return listCredentialGroupsContract.response.schema.parse(result).credentialGroups
    },
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
}

export interface SettingsSectionPrefetchContext {
  workspaceId: string
  userId: string
}

/**
 * First-paint prefetches keyed by section. Keep this sparse: each entry blocks dehydration,
 * must preserve authorization and route projection, and must match the client hook's cache shape.
 * Never bypass a route that redacts sensitive fields.
 */
export const SECTION_PREFETCHERS: Partial<
  Record<
    SettingsSection,
    (queryClient: QueryClient, context: SettingsSectionPrefetchContext) => Promise<unknown>
  >
> = {
  general: (queryClient, { userId }) => prefetchGeneralSettings(queryClient, userId),
  billing: (queryClient, { userId }) => prefetchGeneralSettings(queryClient, userId),
  admin: (queryClient, { userId }) => prefetchGeneralSettings(queryClient, userId),
  'credential-groups': prefetchCredentialGroups,
}
