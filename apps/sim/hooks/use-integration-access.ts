'use client'

import { useCallback, useMemo } from 'react'
import {
  createIntegrationAccessPolicy,
  type IntegrationAccess,
  type IntegrationAccessPolicy,
  resolveIntegrationAccess,
} from '@/lib/integrations/access'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { overlayVisibility } from '@/blocks/visibility/context'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useIntegrationAvailability } from '@/hooks/queries/integration-availability'

interface IntegrationAccessOptions {
  /** `false` until a lazily opened surface opens; nothing is fetched meanwhile. */
  enabled?: boolean
}

interface IntegrationAccessStatus {
  /** Whether both policies have loaded for a workspace. */
  isReady: boolean
  /**
   * Whether a verdict is still coming. Unlike `!isReady`, a policy request that
   * failed has settled, so a caller waiting on this never waits forever.
   */
  isPending: boolean
  isAvailabilityFetching: boolean
  availabilityError: Error | null
  refetchAvailability: ReturnType<typeof useIntegrationAvailability>['refetch']
}

interface IntegrationAccessResult extends IntegrationAccessStatus {
  /**
   * The viewer's access to an integration in the workspace, or `undefined`
   * until `isReady`, so a surface listing integrations fails closed by
   * construction.
   */
  getAccess: (blockType: string) => IntegrationAccess | undefined
}

export interface IntegrationAccessPolicyState extends IntegrationAccessStatus {
  /** The policy as loaded so far: an unloaded side reads as unrestricted. */
  policy: IntegrationAccessPolicy
  oauthServiceAvailability: ReadonlyMap<string, boolean>
  isAvailabilityLoading: boolean
  isAvailabilityReady: boolean
}

/**
 * The integration access policy as loaded so far, which fails open while it
 * loads. Only `usePermissionConfig` reads it, for the workflow toolbar and tool
 * pickers that have always failed open; `check:integration-access` refuses it
 * anywhere else. Every other surface reads {@link useIntegrationAccess}.
 */
export function useIntegrationAccessPolicy(
  workspaceId: string | undefined,
  options?: IntegrationAccessOptions
): IntegrationAccessPolicyState {
  const enabled = options?.enabled ?? true
  const blockOverlayVersion = useCustomBlockOverlayVersion()
  const credentialGroupsEnabled = useOptionalWorkspaceHostContext()?.features?.credentialGroups
  const {
    data: permissionData,
    isSuccess: isPermissionReady,
    isPending: isPermissionPending,
  } = useUserPermissionConfig(enabled ? workspaceId : undefined)
  const {
    data: availabilityData,
    isPending: isAvailabilityPending,
    isLoading: isAvailabilityLoading,
    isFetching: isAvailabilityFetching,
    isSuccess: isAvailabilityReady,
    error: availabilityError,
    refetch: refetchAvailability,
  } = useIntegrationAvailability({ enabled })

  const policy = useMemo(
    () =>
      createIntegrationAccessPolicy({
        groupConfig: permissionData?.config,
        groupAllowlist: permissionData?.config?.allowedIntegrations ?? null,
        deploymentAllowlist: availabilityData?.allowedIntegrations ?? null,
        availability: availabilityData?.integrationAvailability ?? [],
        visibility: overlayVisibility(),
        credentialGroupsEnabled: credentialGroupsEnabled === true,
      }),
    [permissionData?.config, availabilityData, credentialGroupsEnabled, blockOverlayVersion]
  )

  const oauthServiceAvailability = useMemo(
    () =>
      new Map(
        (availabilityData?.oauthServiceAvailability ?? []).map(({ providerId, available }) => [
          providerId.toLowerCase(),
          available,
        ])
      ),
    [availabilityData?.oauthServiceAvailability]
  )

  const isActive = enabled && Boolean(workspaceId)
  const isReady = isActive && isPermissionReady && isAvailabilityReady
  const isPending = isActive && (isPermissionPending || isAvailabilityPending)

  return useMemo(
    () => ({
      policy,
      isReady,
      isPending,
      oauthServiceAvailability,
      isAvailabilityLoading,
      isAvailabilityFetching,
      isAvailabilityReady,
      availabilityError,
      refetchAvailability,
    }),
    [
      policy,
      isReady,
      isPending,
      oauthServiceAvailability,
      isAvailabilityLoading,
      isAvailabilityFetching,
      isAvailabilityReady,
      availabilityError,
      refetchAvailability,
    ]
  )
}

/**
 * The single source of integration access for one workspace: its permission
 * group intersected with the deployment allowlist, then deployment OAuth
 * configuration. Takes the workspace explicitly, because a permission group can
 * target individual workspaces and an organization-level surface asks about
 * several. Without a workspace there is no verdict. `check:integration-access`
 * keeps every surface that lists integrations on it.
 */
export function useIntegrationAccess(
  workspaceId: string | undefined,
  options?: IntegrationAccessOptions
): IntegrationAccessResult {
  const {
    policy,
    isReady,
    isPending,
    isAvailabilityFetching,
    availabilityError,
    refetchAvailability,
  } = useIntegrationAccessPolicy(workspaceId, options)

  const getAccess = useCallback(
    (blockType: string) => (isReady ? resolveIntegrationAccess(blockType, policy) : undefined),
    [isReady, policy]
  )

  return useMemo(
    () => ({
      getAccess,
      isReady,
      isPending,
      isAvailabilityFetching,
      availabilityError,
      refetchAvailability,
    }),
    [getAccess, isReady, isPending, isAvailabilityFetching, availabilityError, refetchAvailability]
  )
}
