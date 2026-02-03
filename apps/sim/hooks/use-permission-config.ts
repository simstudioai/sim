'use client'

import { useMemo } from 'react'
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

export function usePermissionConfig(): PermissionConfigResult {
  const accessControlDisabled = !isHosted && !isAccessControlEnabled
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization

  const { data: permissionData, isLoading } = useUserPermissionConfig(activeOrganization?.id)

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

  const isBlockAllowed = useMemo(() => {
    return (blockType: string) => {
      if (blockType === 'start_trigger') return true
      if (config.allowedIntegrations === null) return true
      return config.allowedIntegrations.includes(blockType)
    }
  }, [config.allowedIntegrations])

  const isProviderAllowed = useMemo(() => {
    return (providerId: string) => {
      if (config.allowedModelProviders === null) return true
      return config.allowedModelProviders.includes(providerId)
    }
  }, [config.allowedModelProviders])

  const filterBlocks = useMemo(() => {
    return <T extends { type: string }>(blocks: T[]): T[] => {
      if (config.allowedIntegrations === null) return blocks
      return blocks.filter(
        (block) =>
          block.type === 'start_trigger' || config.allowedIntegrations!.includes(block.type)
      )
    }
  }, [config.allowedIntegrations])

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

  return useMemo(
    () => ({
      config,
      isLoading,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isProviderAllowed,
      isInvitationsDisabled,
    }),
    [
      config,
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
