'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import {
  isDeploymentGatedIntegrationType,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import {
  intersectAccessControlAllowlists,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/integration-allowlist'
import { createModelAccessGate } from '@/lib/permission-groups/model-access'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { overlayVisibility } from '@/blocks/visibility/context'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useIntegrationAvailability } from '@/hooks/queries/integration-availability'

export interface PermissionConfigResult {
  config: PermissionGroupConfig
  isLoading: boolean
  isInPermissionGroup: boolean
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
  filterProviders: (providerIds: string[]) => string[]
  isBlockAllowed: (blockType: string) => boolean
  /**
   * Whether a model is usable at all: allowed by the model denylist *and* by
   * the provider allowlist. Both gates apply to every model field, so this is
   * the only model predicate the interface exposes.
   */
  isModelUsable: (model: string) => boolean
  isToolAllowed: (toolId: string) => boolean
  isInvitationsDisabled: boolean
  isPublicApiDisabled: boolean
  integrationAvailability: ReadonlyMap<string, IntegrationAvailabilityResponse>
  oauthServiceAvailability: ReadonlyMap<string, boolean>
  isIntegrationAvailabilityLoading: boolean
  isIntegrationAvailabilityFetching: boolean
  isIntegrationAvailabilityReady: boolean
  integrationAvailabilityError: Error | null
  refetchIntegrationAvailability: ReturnType<typeof useIntegrationAvailability>['refetch']
}

export function usePermissionConfig(): PermissionConfigResult {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined
  const blockOverlayVersion = useCustomBlockOverlayVersion()
  const hostContext = useOptionalWorkspaceHostContext()

  const { data: permissionData, isLoading: isPermissionLoading } =
    useUserPermissionConfig(workspaceId)
  const {
    data: envAllowlistData,
    isLoading: isEnvAllowlistLoading,
    isFetching: isIntegrationAvailabilityFetching,
    isSuccess: isIntegrationAvailabilityReady,
    error: integrationAvailabilityError,
    refetch: refetchIntegrationAvailability,
  } = useIntegrationAvailability()

  const isLoading = isPermissionLoading || isEnvAllowlistLoading

  const config = useMemo(() => {
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData])

  const isInPermissionGroup = !!permissionData?.permissionGroupId

  /**
   * Both sides of the membership test are judged as the current block, so a
   * policy naming a retired id — `ALLOWED_INTEGRATIONS=slack` — still permits
   * the successor the editor offers.
   *
   * Each policy is canonicalized *before* the two are intersected, not after: a
   * group naming `slack` and an env allowlist naming `slack_v2` intersect to
   * nothing textually, hiding an integration both policies allow. This is the
   * same helper the server gates use — `mergeEnvAllowlist` for the config the
   * catalog reads, `allowedIntegrationTypes` for the block and selector gates —
   * so what this hook shows and what the server permits cannot disagree.
   */
  const allowedAccessControlTypes = useMemo(
    () =>
      intersectAccessControlAllowlists(
        config.allowedIntegrations,
        envAllowlistData?.allowedIntegrations ?? null
      ),
    [config.allowedIntegrations, envAllowlistData]
  )

  const mergedAllowedIntegrations = useMemo(
    () => (allowedAccessControlTypes === null ? null : [...allowedAccessControlTypes]),
    [allowedAccessControlTypes]
  )

  const integrationAvailability = useMemo(() => {
    const visibility = overlayVisibility()
    return new Map(
      (envAllowlistData?.integrationAvailability ?? []).map((availability) => [
        availability.type.toLowerCase(),
        {
          ...availability,
          state: resolveIntegrationAvailabilityStateForVisibility(availability, visibility),
        },
      ])
    )
  }, [envAllowlistData?.integrationAvailability, blockOverlayVersion])

  const oauthServiceAvailability = useMemo(
    () =>
      new Map(
        (envAllowlistData?.oauthServiceAvailability ?? []).map(({ providerId, available }) => [
          providerId.toLowerCase(),
          available,
        ])
      ),
    [envAllowlistData?.oauthServiceAvailability]
  )

  const isBlockAllowed = useMemo(() => {
    return (blockType: string) => {
      const normalizedBlockType = blockType.toLowerCase()
      if (normalizedBlockType === 'credential_group' && !hostContext?.features?.credentialGroups) {
        return false
      }
      const availability = integrationAvailability.get(normalizedBlockType)
      if (
        isDeploymentGatedIntegrationType(normalizedBlockType) &&
        availability &&
        (availability.state === 'unavailable' || availability.state === 'misconfigured')
      ) {
        return false
      }
      if (isBlockTypeAccessControlExempt(blockType)) return true
      if (allowedAccessControlTypes === null) return true
      return allowedAccessControlTypes.has(resolveAccessControlBlockType(normalizedBlockType))
    }
  }, [hostContext?.features?.credentialGroups, integrationAvailability, allowedAccessControlTypes])

  const isModelUsable = useMemo(
    () =>
      createModelAccessGate({
        deniedModels: config.deniedModels,
        allowedModelProviders: config.allowedModelProviders,
      }),
    [config.deniedModels, config.allowedModelProviders]
  )

  const isToolAllowed = useMemo(
    () => createToolAccessGate(config.deniedTools),
    [config.deniedTools]
  )

  const filterBlocks = useMemo(() => {
    return <T extends { type: string }>(blocks: T[]): T[] => {
      return blocks.filter((block) => isBlockAllowed(block.type))
    }
  }, [isBlockAllowed])

  const filterProviders = useMemo(() => {
    return (providerIds: string[]): string[] => {
      if (config.allowedModelProviders === null) return providerIds
      return providerIds.filter((id) => config.allowedModelProviders!.includes(id))
    }
  }, [config.allowedModelProviders])

  const isInvitationsDisabled = useMemo(() => {
    const featureFlagDisabled = isTruthy(getEnv('NEXT_PUBLIC_DISABLE_INVITATIONS'))
    return featureFlagDisabled || config.disableInvitations
  }, [config.disableInvitations])

  const isPublicApiDisabled = useMemo(() => {
    const featureFlagDisabled = isTruthy(getEnv('NEXT_PUBLIC_DISABLE_PUBLIC_API'))
    return featureFlagDisabled || config.disablePublicApi
  }, [config.disablePublicApi])

  const mergedConfig = useMemo(
    () => ({ ...config, allowedIntegrations: mergedAllowedIntegrations }),
    [config, mergedAllowedIntegrations]
  )

  return useMemo(
    () => ({
      config: mergedConfig,
      isLoading,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isModelUsable,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
      integrationAvailability,
      oauthServiceAvailability,
      isIntegrationAvailabilityLoading: isEnvAllowlistLoading,
      isIntegrationAvailabilityFetching,
      isIntegrationAvailabilityReady,
      integrationAvailabilityError,
      refetchIntegrationAvailability,
    }),
    [
      mergedConfig,
      isLoading,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isModelUsable,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
      integrationAvailability,
      oauthServiceAvailability,
      isEnvAllowlistLoading,
      isIntegrationAvailabilityFetching,
      isIntegrationAvailabilityReady,
      integrationAvailabilityError,
      refetchIntegrationAvailability,
    ]
  )
}
