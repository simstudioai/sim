'use client'

import { useMemo } from 'react'
import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { hasWorkspaceMaxConnectorAccess } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements'
import { useIntegrationAvailability } from '@/hooks/queries/integration-availability'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'
import { useKnowledgeAccess } from '@/platform/lib/data/knowledge/access'

/**
 * What a knowledge base's connectors may do in this workspace: who may administer them, which
 * connection methods the workspace's plan and features offer, and whether the Live interval is
 * available. The legacy page reads the same answers from its workspace providers; here they come
 * from the workspace's host context and the viewer's role.
 */
export function useConnectorScope(workspaceId: string) {
  const host = useWorkspaceHostContextQuery(workspaceId).data
  const access = useKnowledgeAccess(workspaceId)
  const scope = useMemo<ResourceScope>(() => resourceScopeFromOwner({ workspaceId }), [workspaceId])
  return {
    scope,
    canAdmin: Boolean(host) && access.canAdmin,
    memberAccessAvailable: host?.features?.knowledgeMemberAccess === true,
    mirroredAccessAvailable: host?.features?.knowledgeSourceMirroredAccess === true,
    hasMaxAccess: host ? hasWorkspaceMaxConnectorAccess(host.ownerBilling) : false,
  }
}

/**
 * The deployment's integration availability, keyed by lowercased block type, and which OAuth
 * services it can complete: what decides whether a connector may use member or administrator access.
 */
export function useConnectorAvailability() {
  const query = useIntegrationAvailability()
  const integrationAvailability = useMemo(
    () =>
      new Map<string, IntegrationAvailabilityResponse>(
        (query.data?.integrationAvailability ?? []).map((entry) => [
          entry.type.toLowerCase(),
          entry,
        ])
      ),
    [query.data?.integrationAvailability]
  )
  const oauthServiceAvailability = useMemo(
    () =>
      new Map(
        (query.data?.oauthServiceAvailability ?? []).map(({ providerId, available }) => [
          providerId.toLowerCase(),
          available,
        ])
      ),
    [query.data?.oauthServiceAvailability]
  )
  return {
    integrationAvailability,
    oauthServiceAvailability,
    isReady: query.isSuccess,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}
