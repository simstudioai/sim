import type { DelegatedPrincipal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const settingsContextOperation = defineWorkspaceOperation({
  id: 'settings.context',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

/** Resolves the real host organization without granting any organization settings permission. */
export const readSettingsWorkspaceContext = defineAuthorizedWorkspaceUseCase({
  operation: settingsContextOperation,
  resolveContext: ({
    principal,
  }: {
    principal: DelegatedPrincipal
    input: Record<string, never>
  }) => resolveActiveWorkspaceApplicationContext(principal.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:settings', isWithinScope: () => true } },
  async execute({ context }) {
    return { workspaceId: context.workspaceId, organizationId: context.workspaceOrganizationId }
  },
})
