import type { QueryClient } from '@tanstack/react-query'
import { getWorkspaceAccountsContract } from '@/lib/api/contracts/credential-groups'
import { internalSessionAuth } from '@/lib/api/server/routes/internal-json-route'
import { getWorkspaceAccountsSettings } from '@/lib/credential-groups/application/manage-groups'
import { prefetchCurrentUserSettings } from '@/lib/settings/prefetch-current-user-settings'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  credentialGroupKeys,
  WORKSPACE_ACCOUNTS_STALE_TIME,
} from '@/hooks/queries/utils/credential-group-queries'

/** Prefetches workspace accounts through the route's authorization and response boundaries. */
async function prefetchWorkspaceAccounts(
  queryClient: QueryClient,
  { workspaceId }: SettingsSectionPrefetchContext
) {
  return queryClient.prefetchQuery({
    queryKey: credentialGroupKeys.workspace(workspaceId),
    queryFn: async () => {
      const principal = await internalSessionAuth.authenticate()
      const result = await getWorkspaceAccountsSettings.execute({
        principal,
        input: { workspaceId },
      })
      return getWorkspaceAccountsContract.response.schema.parse(result)
    },
    staleTime: WORKSPACE_ACCOUNTS_STALE_TIME,
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
  'credential-groups': prefetchWorkspaceAccounts,
}
