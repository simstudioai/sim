import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import { whitelabelFixture } from '@/platform/fixtures/settings/whitelabeling'

export const settingsWorkspaces = [
  { id: '32e2f8a8-c088-4968-ba70-498e182d8e71', name: 'Customer operations' },
  { id: 'd22aaa4d-3a8e-4b8b-abb4-17cc320707f6', name: 'Finance' },
]
export async function organizationFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const workspaces = settingsWorkspaces
  const scope = `/api/organizations/${state.organizationId}`
  const profile = state.general.profile
  const base = path.startsWith(`${scope}/`) ? path.slice(scope.length) : path
  if (base === '/api/workspaces')
    return {
      lastActiveWorkspaceId: null,
      creationPolicy: null,
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        ownerId: profile.id,
        organizationId: state.organizationId,
        workspaceMode: 'organization',
        permissions: 'admin',
      })),
    }
  if (base === '/workspaces') return { workspaces }
  if (base === '/api/invitations') return { invitations: [] }
  if (base === '/whitelabel') return whitelabelFixture(request, state)
}
