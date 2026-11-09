import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import { loadCatalogWorkspaceContext, resolveCatalogGate } from '@/lib/catalog/application/context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { createIntegrationAccessPolicy } from '@/lib/integrations/access'
import {
  getIntegrationAvailability,
  getOAuthServiceAvailability,
} from '@/lib/integrations/availability.server'
import { getAllOAuthServices } from '@/lib/oauth/utils'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'

export interface ListWorkspaceAppsInput {
  workspaceId: string
}

/**
 * The integration access policy the viewer's apps in one workspace are judged by, the same one the
 * workflow editor's pickers apply: the workspace's permission group, the deployment's allowlist and
 * configuration, and the catalog gate's block visibility. `resolveIntegrationAccess` reads each
 * app's verdict from it. Also which OAuth providers this deployment can complete a sign-in for.
 */
export const listWorkspaceApps = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listWorkspaceApps,
  resolveContext: ({ input }: { input: ListWorkspaceAppsInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: catalogDelegationPolicy },
  async execute({ principal, context }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const [gate, groupConfig, credentialGroupsEnabled] = await Promise.all([
      resolveCatalogGate(principal, context),
      resolvePermissionGroupConfig(userId, context.workspaceId, undefined),
      context.workspaceOrganizationId
        ? isScopedCredentialGroupsAvailable({
            kind: 'organization',
            organizationId: context.workspaceOrganizationId,
          })
        : false,
    ])
    const policy = createIntegrationAccessPolicy({
      groupConfig,
      groupAllowlist: groupConfig?.allowedIntegrations ?? null,
      deploymentAllowlist: getAllowedIntegrationsFromEnv(),
      availability: getIntegrationAvailability(),
      visibility: gate.visibility,
      credentialGroupsEnabled,
    })
    return { policy, oauthAvailability: getOAuthServiceAvailability(getAllOAuthServices()) }
  },
})
