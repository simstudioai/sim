import type { QueryClient } from '@tanstack/react-query'
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

/**
 * Prefetch general settings server-side via the shared data layer.
 *
 * Uses the same query key and mapper as the client `useGeneralSettings` hook, so the
 * hydrated entry is indistinguishable from one a client fetch produced.
 *
 * The authenticated caller supplies the viewer ID it already resolved. Re-reading the session
 * inside the query would add another dependency to a prefetch that is deliberately started as
 * soon as workspace access succeeds.
 *
 * Callers must await the returned promise before dehydration. Only a settled query is included
 * by the current dehydration policy, so dropping the promise would leave the panel to fetch on
 * the client as if it had never been prefetched.
 */
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

/**
 * Prefetch the workspace's credential groups through the same authorized use case the route
 * runs, so the panel paints hydrated instead of blanking until its own fetch returns.
 *
 * The use case is the authorization boundary, not the route: `listCredentialGroupSettings` is a
 * `defineAuthorizedWorkspaceUseCase`, so it resolves canonical context, authorizes the principal
 * and asserts the entitlement before reading. Prefetching through it therefore applies exactly
 * the checks a client request would. Reaching past it to `listCredentialGroups` would not — most
 * settings reads authorize in their route handler, and calling their data layer directly from a
 * server component would skip that gate entirely.
 *
 * A denied or failed prefetch is not fatal: `prefetchQuery` swallows the rejection, nothing is
 * dehydrated for the key, and the client fetches normally and renders the real error.
 */
async function prefetchCredentialGroups(
  queryClient: QueryClient,
  { workspaceId }: SettingsSectionPrefetchContext
) {
  const principal = await internalSessionAuth.authenticate()
  return queryClient.prefetchQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: async () => {
      const { credentialGroups } = await listCredentialGroupSettings.execute({
        principal,
        input: { workspaceId },
      })
      return credentialGroups
    },
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
}

export interface SettingsSectionPrefetchContext {
  workspaceId: string
  userId: string
}

/**
 * The data a section needs on its first paint, keyed by section.
 *
 * A settings section otherwise pays three serial hops — the route payload, its lazily-loaded
 * chunk, and only then its own queries. Seeding the query cache here collapses the third into
 * the first, so the body renders populated the moment its chunk lands rather than blanking
 * again while it fetches.
 *
 * Deliberately sparse, and it should stay that way. Every entry is awaited before dehydration
 * (an unsettled query is dropped from the payload), so a prefetch sits in front of the section
 * it serves — one that is slow, or that most viewers never open, makes the page slower. Two
 * conditions gate entry: the read must go through something that authorizes the viewer itself,
 * and the hydrated value must match what the client hook stores under that key, mapper included.
 *
 * Sections absent here are absent on purpose. Most settings reads authorize in their route
 * handler rather than their data layer, so prefetching them means first lifting the check out of
 * the route — and a few must never be prefetched naively at all, because the route is also what
 * redacts their response (SSO strips the OIDC client secret; MCP withholds credential headers
 * from read-only members). Their `general`/`billing`/`admin` entries below cover a switch that
 * would otherwise paint its default and visibly flip.
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
