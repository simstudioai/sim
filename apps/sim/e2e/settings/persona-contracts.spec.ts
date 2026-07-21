import { SETTINGS_PERSONA_KEYS } from './personas'
import { expect, requirePersona, test } from '../fixtures/persona-test'

for (const personaKey of SETTINGS_PERSONA_KEYS) {
  test(`${personaKey} matches its real API contract`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const persona = requirePersona(personaManifest, personaKey)
    const context = await contextForPersona(personaKey)

    const sessionResponse = await context.request.get('/api/auth/get-session')
    expect(sessionResponse.status()).toBe(200)
    const session = (await sessionResponse.json()) as {
      user?: { id?: string; email?: string; role?: string }
      session?: { activeOrganizationId?: string | null }
    }
    expect(session.user).toMatchObject({
      id: persona.userId,
      email: persona.email,
      role: persona.expectedPlatformRole,
    })
    expect(session.session?.activeOrganizationId ?? null).toBe(
      persona.expectedActiveOrganizationId
    )

    const workspacesResponse = await context.request.get('/api/workspaces?scope=all')
    expect(workspacesResponse.status()).toBe(200)
    const workspacePayload = (await workspacesResponse.json()) as {
      workspaces?: Array<{ id: string; permissions: string; role: string }>
    }
    const expectedAccessible = persona.workspaces
      .filter(({ access }) => access !== 'none')
      .map(({ workspaceId }) => workspaceId)
      .sort()
    expect(workspacePayload.workspaces?.map(({ id }) => id).sort()).toEqual(expectedAccessible)

    for (const expected of persona.workspaces) {
      const response = await context.request.get(
        `/api/workspaces/${encodeURIComponent(expected.workspaceId)}/host-context`
      )
      if (expected.access === 'none') {
        expect(response.status()).toBe(403)
        continue
      }
      expect(response.status()).toBe(200)
      const host = (await response.json()) as {
        workspace?: { id?: string }
        ownerBilling?: { plan?: string; isOrgScoped?: boolean }
        viewer?: {
          permission?: string
          isHostOrganizationMember?: boolean
          isHostOrganizationAdmin?: boolean
        }
      }
      expect(host.workspace?.id).toBe(expected.workspaceId)
      expect(host.viewer?.permission).toBe(expected.access)
      expect(host.ownerBilling?.plan).toBe(expected.hostContext.plan)
      expect(host.ownerBilling?.isOrgScoped).toBe(
        expected.hostContext.payerScope === 'organization'
      )
      expect(host.viewer?.isHostOrganizationMember).toBe(
        expected.hostContext.payerScope === 'organization' &&
          expected.hostContext.hostMembership !== 'external'
      )
      expect(host.viewer?.isHostOrganizationAdmin).toBe(
        expected.hostContext.payerScope === 'organization' &&
          (expected.roleSource === 'owner' || expected.roleSource === 'org-admin')
      )
    }

    const accessibleWorkspace = persona.workspaces.find(({ access }) => access !== 'none')
    expect(accessibleWorkspace).toBeTruthy()
    const groupResponse = await context.request.get(
      `/api/permission-groups/user?workspaceId=${encodeURIComponent(
        accessibleWorkspace?.workspaceId ?? ''
      )}`
    )
    expect(groupResponse.status()).toBe(200)
    const group = (await groupResponse.json()) as {
      permissionGroupId?: string | null
      config?: Record<string, unknown> | null
    }
    if (persona.permissionGroupIds.length > 0) {
      expect(group.permissionGroupId).toBe(persona.permissionGroupIds[0])
      expect(group.config).toMatchObject({
        hideSecretsTab: true,
        hideApiKeysTab: true,
        hideInboxTab: true,
        disableMcpTools: true,
        disableCustomTools: true,
      })
    } else {
      expect(group.permissionGroupId).toBeNull()
    }
  })
}
