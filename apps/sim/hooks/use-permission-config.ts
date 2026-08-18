'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import {
  type GetAllowedIntegrationsResponse,
  getAllowedIntegrationsContract,
  type IntegrationAvailabilityResponse,
} from '@/lib/api/contracts/common'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import {
  isDeploymentGatedIntegrationType,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { overlayVisibility } from '@/blocks/visibility/context'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { findProviderFromModel } from '@/providers/utils'

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
}

const allowedIntegrationsKeys = {
  all: ['allowedIntegrations'] as const,
  env: () => [...allowedIntegrationsKeys.all, 'env'] as const,
}

function useAllowedIntegrationsFromEnv() {
  return useQuery<GetAllowedIntegrationsResponse>({
    queryKey: allowedIntegrationsKeys.env(),
    queryFn: ({ signal }) => requestJson(getAllowedIntegrationsContract, { signal }),
    staleTime: 5 * 60 * 1000,
  })
}

export function usePermissionConfig(): PermissionConfigResult {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined
  const blockOverlayVersion = useCustomBlockOverlayVersion()
  const hostContext = useOptionalWorkspaceHostContext()

  const { data: permissionData, isLoading: isPermissionLoading } =
    useUserPermissionConfig(workspaceId)
  const { data: envAllowlistData, isLoading: isEnvAllowlistLoading } =
    useAllowedIntegrationsFromEnv()

  const isLoading = isPermissionLoading || isEnvAllowlistLoading

  const config = useMemo(() => {
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData])

  const isInPermissionGroup = !!permissionData?.permissionGroupId

  const mergedAllowedIntegrations = useMemo(() => {
    const envAllowlist = envAllowlistData?.allowedIntegrations ?? null
    return intersectIntegrationAllowlists(config.allowedIntegrations, envAllowlist)
  }, [config.allowedIntegrations, envAllowlistData])

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
      if (mergedAllowedIntegrations === null) return true
      return mergedAllowedIntegrations.includes(normalizedBlockType)
    }
  }, [hostContext?.features?.credentialGroups, integrationAvailability, mergedAllowedIntegrations])

  const isProviderAllowed = useMemo(() => {
    return (providerId: string) => {
      if (config.allowedModelProviders === null) return true
      return config.allowedModelProviders.includes(providerId)
    }
  }, [config.allowedModelProviders])

  /** Indexed so the per-model check stays O(1) over a long denylist. */
  const deniedModelSet = useMemo(
    () => new Set(config.deniedModels.map((denied) => denied.toLowerCase())),
    [config.deniedModels]
  )

  const isModelAllowed = useMemo(() => {
    return (model: string) => !deniedModelSet.has(model.toLowerCase())
  }, [deniedModelSet])

  const isModelUsable = useMemo(() => {
    return (model: string) => {
      if (!isModelAllowed(model)) return false
      const providerId = findProviderFromModel(model)
      /* Only chat models resolve to a provider. A `model` field holding an
         embedding, speech, image or video id is not a provider choice, so the
         provider allowlist has nothing to say about it — judging it anyway
         would read every such id as Ollama and reject it. */
      if (!providerId) return true
      return isProviderAllowed(providerId)
    }
  }, [isModelAllowed, isProviderAllowed])

  /** Indexed so the per-tool check stays O(1) over a long denylist. */
  const deniedToolSet = useMemo(() => new Set(config.deniedTools), [config.deniedTools])

  const isToolAllowed = useMemo(() => {
    return (toolId: string) => !deniedToolSet.has(toolId)
  }, [deniedToolSet])

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
    ]
  )
}
