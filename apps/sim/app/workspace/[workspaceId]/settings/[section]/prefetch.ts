import type { QueryClient } from '@tanstack/react-query'
import { listCredentialGroupsContract } from '@/lib/api/contracts/credential-groups'
import { internalSessionAuth } from '@/lib/api/server/routes/internal-json-route'
import { listCredentialGroupSettings } from '@/lib/credential-groups/application/manage-groups'
import { prefetchCurrentUserSettings } from '@/lib/settings/prefetch-current-user-settings'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
} from '@/hooks/queries/utils/credential-group-queries'

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
      /**
       * Hydrates the whole response envelope, matching what `fetchCredentialGroupSettings` caches
       * under this key. Narrowing to the groups array here would seed the shared entry with a
       * shape its consumers do not read, so every one of them would see an empty list until the
       * first refetch replaced it.
       */
      return listCredentialGroupsContract.response.schema.parse(result)
    },
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
}

export interface SettingsSectionPrefetchContext {
  workspaceId: string
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
  general: (queryClient) => prefetchCurrentUserSettings(queryClient),
  billing: (queryClient) => prefetchCurrentUserSettings(queryClient),
  admin: (queryClient) => prefetchCurrentUserSettings(queryClient),
  'credential-groups': prefetchCredentialGroups,
}
