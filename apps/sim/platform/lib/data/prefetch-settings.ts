import 'server-only'
import { type DehydratedState, dehydrate, type QueryClient } from '@tanstack/react-query'
import { listSsoProvidersContract } from '@/lib/api/contracts/auth'
import {
  getOrganizationDataRetentionContract,
  getOrganizationSessionPolicyContract,
} from '@/lib/api/contracts/organization'
import { getOrganizationNetworkContract } from '@/lib/api/contracts/organization-network'
import {
  listOrganizationWorkspacesContract,
  listPermissionGroupsContract,
} from '@/lib/api/contracts/permission-groups'
import { presentPermissionGroup } from '@/lib/api/server/permission-group-presenters'
import { presentSsoProviderSettings } from '@/lib/api/server/sso-presenters'
import { listSsoProviders } from '@/lib/auth/sso/application/provider-settings'
import { readOrganizationNetwork } from '@/lib/core/network/application/read-organization-network'
import {
  getOrganizationDataRetention,
  getOrganizationSessionPolicy,
} from '@/lib/organizations/application/configuration'
import {
  listPermissionGroups,
  listPermissionGroupWorkspaces,
} from '@/lib/permission-groups/application/use-cases'
import {
  ORGANIZATION_NETWORK_STALE_TIME,
  organizationNetworkKeys,
} from '@/hooks/queries/organization-network'
import {
  DATA_RETENTION_STALE_TIME,
  dataRetentionKeys,
} from '@/hooks/queries/utils/data-retention-keys'
import {
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  SESSION_POLICY_STALE_TIME,
  sessionPolicyKeys,
} from '@/hooks/queries/utils/session-policy-keys'
import { SSO_PROVIDERS_STALE_TIME, ssoKeys } from '@/hooks/queries/utils/sso-keys'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'
import { type LiveSettingsKey, resolveLiveSetting } from '@/platform/lib/data/settings-navigation'

/**
 * Seeds `queryClient` with a browser-rendered section's first reads, under each hook's own key and
 * `staleTime` and in the shape its `queryFn` returns, so the section's queries start with the page
 * instead of after its code loads.
 */
type SectionPrefetch = (
  queryClient: QueryClient,
  organization: PlatformOrganization
) => Promise<unknown>

type SessionPrincipal = Awaited<ReturnType<typeof requireSessionViewer>>['principal']

/** One read under the shared budget, as the viewer, through the route's own use case and contract. */
async function asViewer<T>(read: (principal: SessionPrincipal) => Promise<T>) {
  return withinPrefetchBudget(async () => read((await requireSessionViewer()).principal))
}

const SECTION_PREFETCHES: Partial<Record<LiveSettingsKey, SectionPrefetch>> = {
  security: (queryClient, { organization, deployment }) => {
    const organizationId = organization.id
    return Promise.all([
      (deployment.hosted || deployment.features.sessionPolicies) &&
        queryClient.prefetchQuery({
          queryKey: sessionPolicyKeys.settings(organizationId),
          queryFn: () =>
            asViewer(async (principal) => {
              const response = await asRouteResponse(getOrganizationSessionPolicyContract, {
                success: true,
                data: await getOrganizationSessionPolicy.execute({
                  principal,
                  input: { organizationId },
                }),
              })
              return response.data
            }),
          staleTime: SESSION_POLICY_STALE_TIME,
        }),
      queryClient.prefetchQuery({
        queryKey: organizationNetworkKeys.detail(organizationId),
        queryFn: () =>
          asViewer(async (principal) =>
            asRouteResponse(
              getOrganizationNetworkContract,
              await readOrganizationNetwork.execute({ principal, input: { organizationId } })
            )
          ),
        staleTime: ORGANIZATION_NETWORK_STALE_TIME,
      }),
    ])
  },
  'data-retention': (queryClient, { organization }) => {
    const organizationId = organization.id
    return queryClient.prefetchQuery({
      queryKey: dataRetentionKeys.settings(organizationId),
      queryFn: () =>
        asViewer(async (principal) => {
          const response = await asRouteResponse(getOrganizationDataRetentionContract, {
            success: true,
            data: await getOrganizationDataRetention.execute({
              principal,
              input: { organizationId },
            }),
          })
          return response.data
        }),
      staleTime: DATA_RETENTION_STALE_TIME,
    })
  },
  sso: (queryClient, { organization }) => {
    const organizationId = organization.id
    return queryClient.prefetchQuery({
      queryKey: ssoKeys.providerList(organizationId),
      queryFn: () =>
        asViewer(async (principal) => {
          const { providers } = await listSsoProviders.execute({
            principal,
            input: { organizationId },
          })
          return asRouteResponse(listSsoProvidersContract, {
            providers: providers.map(presentSsoProviderSettings),
          })
        }),
      staleTime: SSO_PROVIDERS_STALE_TIME,
    })
  },
  'access-control': (queryClient, { organization }) => {
    const organizationId = organization.id
    return Promise.all([
      queryClient.prefetchQuery({
        queryKey: permissionGroupKeys.list(organizationId),
        queryFn: () =>
          asViewer(async (principal) => {
            const { data } = await listPermissionGroups.execute({
              principal,
              input: { organizationId },
            })
            const response = await asRouteResponse(listPermissionGroupsContract, {
              permissionGroups: data.map(presentPermissionGroup),
            })
            return response.permissionGroups ?? []
          }),
        staleTime: PERMISSION_GROUPS_STALE_TIME,
      }),
      queryClient.prefetchQuery({
        queryKey: permissionGroupKeys.orgWorkspaces(organizationId),
        queryFn: () =>
          asViewer(async (principal) => {
            const { data } = await listPermissionGroupWorkspaces.execute({
              principal,
              input: { organizationId },
            })
            const response = await asRouteResponse(listOrganizationWorkspacesContract, {
              workspaces: data,
            })
            return response.workspaces
          }),
        staleTime: PERMISSION_GROUPS_STALE_TIME,
      }),
    ])
  },
}

/**
 * The first-paint reads of the browser-rendered Settings section `path` opens, dehydrated for its
 * `HydrationBoundary`, or `null` when the viewer may not open it or it has none. A read that fails
 * or runs out of budget is left out, and the section's hook fetches it as it would have.
 */
export async function prefetchSettingsSection(
  path: readonly string[],
  organization: PlatformOrganization
): Promise<DehydratedState | null> {
  const setting = resolveLiveSetting(path[0] ?? 'general', organization)
  const prefetch = setting && SECTION_PREFETCHES[setting.key]
  if (!prefetch) return null
  const queryClient = makeQueryClient()
  await prefetch(queryClient, organization)
  return dehydrate(queryClient)
}
