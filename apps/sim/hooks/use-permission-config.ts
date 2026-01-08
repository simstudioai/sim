import { useMemo } from 'react'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { useOrganizations } from '@/hooks/queries/organization'
import { useUserPermissionConfig } from '@/hooks/queries/permission-groups'

export interface PermissionConfigResult {
  config: PermissionGroupConfig
  isLoading: boolean
  isInPermissionGroup: boolean
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
  filterProviders: (providerIds: string[]) => string[]
  isBlockAllowed: (blockType: string) => boolean
  isProviderAllowed: (providerId: string) => boolean
}

export function usePermissionConfig(): PermissionConfigResult {
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization

  const { data: permissionData, isLoading } = useUserPermissionConfig(activeOrganization?.id)

  const config = useMemo(() => {
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData])

  const isInPermissionGroup = !!permissionData?.permissionGroupId

  const isBlockAllowed = useMemo(() => {
    return (blockType: string) => {
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
      return blocks.filter((block) => config.allowedIntegrations!.includes(block.type))
    }
  }, [config.allowedIntegrations])

  const filterProviders = useMemo(() => {
    return (providerIds: string[]): string[] => {
      if (config.allowedModelProviders === null) return providerIds
      return providerIds.filter((id) => config.allowedModelProviders!.includes(id))
    }
  }, [config.allowedModelProviders])

  return {
    config,
    isLoading,
    isInPermissionGroup,
    filterBlocks,
    filterProviders,
    isBlockAllowed,
    isProviderAllowed,
  }
}
