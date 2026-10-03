'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type StartSlackCredentialGroupConfigurationBody,
  startSlackCredentialGroupConfigurationContract,
} from '@/lib/api/contracts/credential-groups'
import { startOrganizationSlackConfigurationContract } from '@/lib/api/contracts/organization-accounts'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  credentialGroupKeys,
  fetchWorkspaceAccounts,
  WORKSPACE_ACCOUNTS_STALE_TIME,
} from '@/hooks/queries/utils/credential-group-queries'

export function useWorkspaceAccounts(workspaceId?: string) {
  return useQuery({
    queryKey: credentialGroupKeys.workspace(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID is required')
      return fetchWorkspaceAccounts(workspaceId, signal)
    },
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_ACCOUNTS_STALE_TIME,
  })
}

export function useStartSlackCredentialGroupConfiguration() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      organizationId,
      credentialGroupId,
      body,
    }: {
      credentialGroupId: string
      body: StartSlackCredentialGroupConfigurationBody
    } & (
      | { workspaceId: string; organizationId?: never }
      | { organizationId: string; workspaceId?: never }
    )) => {
      const scope = resourceScopeFromOwner({ workspaceId, organizationId })
      if (scope.kind === 'organization') {
        if (!body.appId || !body.teamId)
          throw new Error('Slack App ID and workspace ID are required')
        return requestJson(startOrganizationSlackConfigurationContract, {
          params: { id: scope.organizationId, groupId: credentialGroupId },
          body: {
            appId: body.appId,
            teamId: body.teamId,
            requiredScopes: body.requiredScopes,
          },
        })
      }
      return requestJson(startSlackCredentialGroupConfigurationContract, {
        params: { id: scope.workspaceId, groupId: credentialGroupId },
        body,
      })
    },
  })
}
