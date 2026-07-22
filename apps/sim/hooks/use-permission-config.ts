'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'

export interface PermissionConfigResult {
  config: PermissionGroupConfig
  isLoading: boolean
  isError: boolean
  isInPermissionGroup: boolean
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
  filterProviders: (providerIds: string[]) => string[]
  isBlockAllowed: (blockType: string) => boolean
  isProviderAllowed: (providerId: string) => boolean
  isModelAllowed: (model: string) => boolean
  isToolAllowed: (toolId: string) => boolean
  isInvitationsDisabled: boolean
  isPublicApiDisabled: boolean
}

interface AllowedIntegrationsResponse {
  allowedIntegrations: string[] | null
}

const allowedIntegrationsKeys = {
  all: ['allowedIntegrations'] as const,
  env: () => [...allowedIntegrationsKeys.all, 'env'] as const,
}

function useAllowedIntegrationsFromEnv() {
  return useQuery<AllowedIntegrationsResponse>({
    queryKey: allowedIntegrationsKeys.env(),
    queryFn: async ({ signal }) => {
      try {
        return await requestJson(getAllowedIntegrationsContract, { signal })
      } catch (error) {
        // Treat any auth/server failure as "no env allowlist configured"
        // so the UI falls back to the permission-group-driven allowlist.
        if (error instanceof ApiClientError) {
          return { allowedIntegrations: null }
        }
        throw error
      }
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
  if (b === null) return a.map((i) => i.toLowerCase())
  return a.map((i) => i.toLowerCase()).filter((i) => b.includes(i))
}

export function usePermissionConfig(): PermissionConfigResult {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  const {
    data: permissionData,
    isLoading: isPermissionLoading,
    isError: isPermissionError,
  } = useUserPermissionConfig(workspaceId)
  const {
    data: envAllowlistData,
    isLoading: isEnvAllowlistLoading,
    isError: isEnvAllowlistError,
  } = useAllowedIntegrationsFromEnv()

  const isLoading = isPermissionLoading || isEnvAllowlistLoading
  const isError = isPermissionError || isEnvAllowlistError

  const config = useMemo(() => {
    if (!permissionData?.config) {
      return DEFAULT_PERMISSION_GROUP_CONFIG
    }
    return permissionData.config
  }, [permissionData])

  const isInPermissionGroup = !!permissionData?.permissionGroupId

  const mergedAllowedIntegrations = useMemo(() => {
    const envAllowlist = envAllowlistData?.allowedIntegrations ?? null
    return intersectAllowlists(config.allowedIntegrations, envAllowlist)
  }, [config.allowedIntegrations, envAllowlistData])

  const isBlockAllowed = useMemo(() => {
    return (blockType: string) => {
      if (isBlockTypeAccessControlExempt(blockType)) return true
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

  const isModelAllowed = useMemo(() => {
    return (model: string) => {
      if (config.deniedModels.length === 0) return true
      const normalized = model.toLowerCase()
      return !config.deniedModels.some((denied) => denied.toLowerCase() === normalized)
    }
  }, [config.deniedModels])

  const isToolAllowed = useMemo(() => {
    return (toolId: string) => {
      if (config.deniedTools.length === 0) return true
      return !config.deniedTools.includes(toolId)
    }
  }, [config.deniedTools])

  const filterBlocks = useMemo(() => {
    return <T extends { type: string }>(blocks: T[]): T[] => {
      if (mergedAllowedIntegrations === null) return blocks
      return blocks.filter(
        (block) =>
          isBlockTypeAccessControlExempt(block.type) ||
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
      isError,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isProviderAllowed,
      isModelAllowed,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
    }),
    [
      mergedConfig,
      isLoading,
      isError,
      isInPermissionGroup,
      filterBlocks,
      filterProviders,
      isBlockAllowed,
      isProviderAllowed,
      isModelAllowed,
      isToolAllowed,
      isInvitationsDisabled,
      isPublicApiDisabled,
    ]
  )
}
