import { WORKSPACE_SETTINGS_ITEMS } from '@/components/settings/navigation'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { authorizeWorkspaceSettingsSection } from '@/lib/settings/application/workspace-section-access'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

// permission-group-exempt: Navigation describes section access; each section retains its own capability gate.
export const readWorkspaceSettingsNavigationOperation = defineWorkspaceOperation({
  id: 'settings.workspace_navigation.read',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['session'],
})

/** Reuses the routed settings gate before the pane mounts any protected section. */
export const readWorkspaceSettingsNavigation = defineAuthorizedWorkspaceUseCase({
  operation: readWorkspaceSettingsNavigationOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, context }) {
    const sections = await Promise.all(
      WORKSPACE_SETTINGS_ITEMS.map(async ({ id }) => {
        const access = await authorizeWorkspaceSettingsSection({
          workspaceId: context.workspaceId,
          userId: principal.userId,
          section: id === 'api-keys' ? 'apikeys' : id,
        })
        if (access.allowed) return { id, access: 'allowed' as const }
        if (access.disposition === 'request-access')
          return { id, access: 'request-access' as const }
        return null
      })
    )
    return { sections: sections.filter((section) => section !== null) }
  },
})
