/**
 * @vitest-environment node
 *
 * The workspace layout authorizes with this read and the shell renders the organization it names.
 * Failure modes: an organization-less workspace (a personal workspace kept outside the team its
 * owner joined) answering not found, or opening in an organization other than the viewer's; and a
 * workspace the viewer cannot open disclosing an organization.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const { checkWorkspaceAccess, resolveOrganizationLanding, headerValue } = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
  resolveOrganizationLanding: vi.fn(),
  headerValue: { current: null as string | null },
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(headerValue.current ? { 'x-sim-shell-scope': headerValue.current } : {}),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess }))
vi.mock('@/lib/organizations/surface', () => ({ resolveOrganizationLanding }))

import {
  readShellOrganizationId,
  readWorkspaceShellOrganizationId,
} from '@/platform/lib/data/shell-scope'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

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

beforeEach(() => {
  checkWorkspaceAccess.mockReset()
  resolveOrganizationLanding.mockReset().mockResolvedValue('viewer-org')
  vi.mocked(getSession).mockResolvedValue(SESSION)
  headerValue.current = 'workspace:ws-1'
})

describe('readWorkspaceShellOrganizationId', () => {
  it("opens an organization-less workspace the viewer can open in the viewer's organization", async () => {
    checkWorkspaceAccess.mockResolvedValue(access(null))
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBe('viewer-org')
    expect(await readShellOrganizationId()).toBe('viewer-org')
    expect(checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'viewer')
    expect(resolveOrganizationLanding).toHaveBeenCalledWith('viewer', null)
  })

  it('opens a workspace in an organization in its own organization', async () => {
    checkWorkspaceAccess.mockResolvedValue(access('team-org'))
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBe('team-org')
    expect(resolveOrganizationLanding).not.toHaveBeenCalled()
  })

  it.each([null, 'team-org'])(
    'names no organization for a workspace the viewer cannot open (organization %s)',
    async (organizationId) => {
      checkWorkspaceAccess.mockResolvedValue(access(organizationId, false))
      expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
      expect(await readShellOrganizationId()).toBeUndefined()
      expect(resolveOrganizationLanding).not.toHaveBeenCalled()
    }
  )
})
