import type { SessionPrincipal } from '@sim/auth/principal'
import type { QueryClient } from '@tanstack/react-query'
import { discoverAccessRequestsContract } from '@/lib/api/contracts/access-requests'
import {
  type UserPermissionConfig,
  userPermissionConfigSchema,
} from '@/lib/api/contracts/permission-groups'
import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { PLATFORM_FEATURES } from '@/lib/permission-groups/features'
import {
  ACCESS_REQUESTS_STALE_TIME,
  accessRequestKeys,
  workspaceFeatureDiscoveryQuery,
} from '@/hooks/queries/utils/access-request-keys'
import {
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'

/** Seeds the boundary's existing queries; failed reads remain unhydrated and recover in the client. */
export async function prefetchWorkspaceAccess(
  queryClient: QueryClient,
  workspaceId: string,
  principal: SessionPrincipal
): Promise<void> {
  const queryKey = permissionGroupKeys.userConfig(workspaceId)
  await queryClient.prefetchQuery({
    queryKey,
    queryFn: async () =>
      userPermissionConfigSchema.parse(
        await readUserPermissionConfig.execute({ principal, input: { workspaceId } })
      ),
    staleTime: PERMISSION_GROUPS_STALE_TIME,
  })

  const policy = queryClient.getQueryData<UserPermissionConfig>(queryKey)
  if (
    !PLATFORM_FEATURES.some(
      (feature) => feature.scope !== 'organization' && policy?.config?.[feature.configKey]
    )
  )
    return

  const query = workspaceFeatureDiscoveryQuery(workspaceId)
  await queryClient.prefetchQuery({
    queryKey: accessRequestKeys.discovery(query),
    queryFn: async () => {
      const { discoverAccessRequests } = await import(
        '@/lib/permission-access-requests/application/requests'
      )
      return discoverAccessRequestsContract.response.schema.parse(
        await discoverAccessRequests.execute({ principal, input: query })
      )
    },
    staleTime: ACCESS_REQUESTS_STALE_TIME,
  })
}
