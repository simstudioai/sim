'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isAccessControlEnabled, isHosted } from '@/lib/core/config/feature-flags'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useOrganizations } from '@/hooks/queries/organization'

export interface PermissionConfigResult {
  config: PermissionGroupConfig
  isLoading: boolean
  isInPermissionGroup: boolean
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
  filterProviders: (providerIds: string[]) => string[]
  isBlockAllowed: (blockType: string) => boolean
  isProviderAllowed: (providerId: string) => boolean
  isInvitationsDisabled: boolean
}

interface AllowedIntegrationsResponse {
  allowedIntegrations: string[] | null
}

function useAllowedIntegrationsFromEnv() {
  return useQuery<AllowedIntegrationsResponse>({
    queryKey: ['allowedIntegrations', 'env'],
    queryFn: async () => {
      const response = await fetch('/api/settings/allowed-integrations')
      if (!response.ok) return { allowedIntegrations: null }
      return response.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Intersects two allowlists. If either is null (unrestricted), returns the other.
 * If both are set, returns only items present in both.
 */
function intersectAllowlists(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b
  if (b === null) return a
  return a.map((i) => i.toLowerCase()).filter((i) => b.includes(i))
}

export function usePermissionConfig(): PermissionConfigResult {
  const accessControlDisabled = !isHosted && !isAccessControlEnabled
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization

  const { data: permissionData, isLoading: isPermissionLoading } = useUserPermissionConfig(
    activeOrganization?.id
  )
  const { data: envAllowlistData, isLoading: isEnvAllowlistLoading } =
    useAllowedIntegrationsFromEnv()

  const isLoading = isPermissionLoading || isEnvAllowlistLoading

  const config = useMemo(() => {
    if (accessControlDisabled) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData, accessControlDisabled])

  const isInPermissionGroup = !accessControlDisabled && !!permissionData?.permissionGroupId

  const mergedAllowedIntegrations = useMemo(() => {
    const envAllowlist = envAllowlistData?.allowedIntegrations ?? null
    return intersectAllowlists(config.allowedIntegrations, envAllowlist)
  }, [config.allowedIntegrations, envAllowlistData])

  const isBlockAllowed = useMemo(() => {
    return (blockType: string) => {
      if (blockType === 'start_trigger') return true
      if (mergedAllowedIntegrations === null) return true
      return mergedAllowedIntegrations.includes(blockType.toLowerCase())
    }
  }, [mergedAllowedIntegrations])

  const isProviderAllowed = useMemo(() => {
    return (providerId: string) => {
      if (config.allowedModelProviders === null) return true
      return config.allowedModelProviders.includes(providerId)
    }
  }, [config.allowedModelProviders])

  const filterBlocks = useMemo(() => {
    return <T extends { type: string }>(blocks: T[]): T[] => {
      if (mergedAllowedIntegrations === null) return blocks
      return blocks.filter(
        (block) =>
          block.type === 'start_trigger' ||
          mergedAllowedIntegrations.includes(block.type.toLowerCase())
      )
    }
  }, [mergedAllowedIntegrations])

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
      isProviderAllowed,
      isInvitationsDisabled,
    }),
    [
      mergedConfig,
      isLoading,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isProviderAllowed,
      isInvitationsDisabled,
    ]
  )
}
