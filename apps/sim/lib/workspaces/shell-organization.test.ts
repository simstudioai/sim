/**
 * @vitest-environment node
 *
 * The workspace layout, the shell scope and the legacy redirects all open a workspace in the
 * organization this resolves. Failure modes: an organization-less workspace (a personal workspace
 * kept outside the team its owner joined) resolving to nothing, so its pages answer not found and
 * its saved links 404, or to an organization other than the viewer's; and a workspace the viewer
 * cannot open disclosing an organization.
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const { resolveOrganizationLanding } = vi.hoisted(() => ({
  resolveOrganizationLanding: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/organizations/surface', () => ({ resolveOrganizationLanding }))

import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/shell-organization'

const checkWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess

function access(organizationId: string | null, hasAccess = true): WorkspaceAccess {
  return {
    exists: true,
    hasAccess,
    canWrite: hasAccess,
    canAdmin: false,
    permission: hasAccess ? 'write' : null,
    workspace: { id: 'ws-1', organizationId } as WorkspaceAccess['workspace'],
  }
}

async function legacyTarget(path: string) {
  const [pathname, search = ''] = path.split('?')
  return mapLegacyWorkspaceUrl({
    workspaceId: 'ws-1',
    segments: pathname.split('/'),
    query: new URLSearchParams(search),
    organizationId: await resolveWorkspaceShellOrganizationId('ws-1', 'viewer'),
  })
}

beforeEach(() => {
  checkWorkspaceAccess.mockReset()
  resolveOrganizationLanding.mockReset().mockResolvedValue('viewer-org')
})

describe('resolveWorkspaceShellOrganizationId', () => {
  it("opens an organization-less workspace the viewer can open in the viewer's organization", async () => {
    checkWorkspaceAccess.mockResolvedValue(access(null))
    expect(await resolveWorkspaceShellOrganizationId('ws-1', 'viewer')).toBe('viewer-org')
    expect(checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'viewer')
    expect(resolveOrganizationLanding).toHaveBeenCalledWith('viewer', null)
  })

  it('opens a workspace in an organization in its own organization', async () => {
    checkWorkspaceAccess.mockResolvedValue(access('team-org'))
    expect(await resolveWorkspaceShellOrganizationId('ws-1', 'viewer')).toBe('team-org')
    expect(resolveOrganizationLanding).not.toHaveBeenCalled()
  })

  it.each([null, 'team-org'])(
    'names no organization for a workspace the viewer cannot open (organization %s)',
    async (organizationId) => {
      checkWorkspaceAccess.mockResolvedValue(access(organizationId, false))
      expect(await resolveWorkspaceShellOrganizationId('ws-1', 'viewer')).toBeNull()
      expect(resolveOrganizationLanding).not.toHaveBeenCalled()
    }
  )
})

describe("an organization-less workspace's legacy URLs", () => {
  it.each([
    ['home', '/o/viewer-org/home'],
    ['chat/chat-1', '/o/viewer-org/chat/chat-1'],
    ['skills', '/o/viewer-org/integrations?tab=skills&workspace=ws-1'],
    ['integrations', '/o/viewer-org/integrations'],
    ['upgrade?reason=credits', '/o/viewer-org/settings/billing/plans?reason=credits'],
  ])("send /workspace/ws-1/%s to the viewer's organization", async (path, target) => {
    checkWorkspaceAccess.mockResolvedValue(access(null))
    expect(await legacyTarget(path)).toBe(target)
  })

  it('have no destination for a viewer who cannot open the workspace', async () => {
    checkWorkspaceAccess.mockResolvedValue(access(null, false))
    expect(await legacyTarget('home')).toBeNull()
  })
})
