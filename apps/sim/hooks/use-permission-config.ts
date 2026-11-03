'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { resolveIntegrationAccess } from '@/lib/integrations/access'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import { createModelAccessGate } from '@/lib/permission-groups/model-access'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import {
  type IntegrationAccessPolicyState,
  useIntegrationAccessPolicy,
} from '@/hooks/use-integration-access'

export interface PermissionConfigResult {
  config: PermissionGroupConfig
  isLoading: boolean
  isPermissionFetching: boolean
  isPermissionReady: boolean
  refetchPermissionConfig: ReturnType<typeof useUserPermissionConfig>['refetch']
  isInPermissionGroup: boolean
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
  filterProviders: (providerIds: string[]) => string[]
  /**
   * Whether a block's integration access is `available`. Fails open while the
   * policies load, as the workflow toolbar and tool pickers always have; a
   * surface listing integrations reads `useIntegrationAccess` instead.
   */
  isBlockAllowed: (blockType: string) => boolean
  /** Presentation-only hint; request creation revalidates the deployed public catalog. */
  isBlockRequestable: (blockType: string) => boolean
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
  refetchIntegrationAvailability: IntegrationAccessPolicyState['refetchAvailability']
}

export function usePermissionConfig(): PermissionConfigResult {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  const {
    data: permissionData,
    isLoading: isPermissionLoading,
    isFetching: isPermissionFetching,
    isSuccess: isPermissionReady,
    refetch: refetchPermissionConfig,
  } = useUserPermissionConfig(workspaceId)
  const {
    policy,
    isReady: isIntegrationAccessReady,
    oauthServiceAvailability,
    isAvailabilityLoading: isIntegrationAvailabilityLoading,
    isAvailabilityFetching: isIntegrationAvailabilityFetching,
    isAvailabilityReady: isIntegrationAvailabilityReady,
    availabilityError: integrationAvailabilityError,
    refetchAvailability: refetchIntegrationAvailability,
  } = useIntegrationAccessPolicy(workspaceId)

  const isLoading = isPermissionLoading || isIntegrationAvailabilityLoading

  const config = useMemo(() => {
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData])

  const isInPermissionGroup = !!permissionData?.permissionGroupId

  /**
   * The effective allowlist (group ∩ deployment) in the resolved vocabulary, so
   * a policy naming a retired id still permits its successor. Server gates
   * intersect with the same helper, so what this hook shows and what the server
   * permits cannot disagree.
   */
  const mergedAllowedIntegrations = useMemo(
    () => (policy.allowlist === null ? null : [...policy.allowlist]),
    [policy.allowlist]
  )

  const isBlockAllowed = useMemo(
    () => (blockType: string) => resolveIntegrationAccess(blockType, policy) === 'available',
    [policy]
  )

  const isBlockRequestable = useMemo(
    () => (blockType: string) =>
      isIntegrationAccessReady && resolveIntegrationAccess(blockType, policy) === 'requestable',
    [isIntegrationAccessReady, policy]
  )

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
      isPermissionFetching,
      isPermissionReady,
      refetchPermissionConfig,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isBlockRequestable,
      isModelUsable,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
      integrationAvailability: policy.availability,
      oauthServiceAvailability,
      isIntegrationAvailabilityLoading,
      isIntegrationAvailabilityFetching,
      isIntegrationAvailabilityReady,
      integrationAvailabilityError,
      refetchIntegrationAvailability,
    }),
    [
      mergedConfig,
      isLoading,
      isPermissionFetching,
      isPermissionReady,
      refetchPermissionConfig,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isBlockRequestable,
      isModelUsable,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
      policy.availability,
      oauthServiceAvailability,
      isIntegrationAvailabilityLoading,
      isIntegrationAvailabilityFetching,
      isIntegrationAvailabilityReady,
      integrationAvailabilityError,
      refetchIntegrationAvailability,
    ]
  )
}
