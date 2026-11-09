/**
 * @vitest-environment node
 *
 * The workspace layout authorizes with this read and the shell renders the organization it names.
 * Failure modes: a `/workspace/<id>` shell resolving the workspace for someone other than the
 * signed-in viewer, or rendering an organization for a workspace the viewer cannot open; and a
 * shell outside any named organization finding none for an account in no organization (access
 * denied on every page) instead of provisioning their personal one. Which organization a workspace
 * opens in is proven in `personal-organization-shell.integration.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'

const { resolveWorkspaceShellOrganizationId, resolveOrProvisionLandingOrganization, headerValue } =
  vi.hoisted(() => ({
    resolveWorkspaceShellOrganizationId: vi.fn(),
    resolveOrProvisionLandingOrganization: vi.fn(),
    headerValue: { current: null as string | null },
  }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(headerValue.current ? { 'x-sim-shell-scope': headerValue.current } : {}),
}))
vi.mock('@/lib/workspaces/shell-organization', () => ({ resolveWorkspaceShellOrganizationId }))
vi.mock('@/lib/organizations/provision-personal', () => ({
  resolveOrProvisionLandingOrganization,
}))

import {
  readShellOrganizationId,
  readWorkspaceShellOrganizationId,
} from '@/platform/lib/data/shell-scope'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  resolveWorkspaceShellOrganizationId.mockReset()
  resolveOrProvisionLandingOrganization.mockReset().mockResolvedValue('landing-org')
  vi.mocked(getSession).mockResolvedValue(SESSION)
  headerValue.current = 'workspace:ws-1'
})

describe('the shell scope of a workspace URL', () => {
  it('renders the organization the workspace opens in for the signed-in viewer', async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue('viewer-org')
    expect(await readShellOrganizationId()).toBe('viewer-org')
    expect(resolveWorkspaceShellOrganizationId).toHaveBeenCalledWith(
      'ws-1',
      'viewer',
      expect.any(Function)
    )
  })

  it("leaves the shell in the viewer's landing organization for a workspace they cannot open", async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue(null)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(await readShellOrganizationId()).toBe('landing-org')
  })

  it('opens nothing for a signed-out request', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(resolveWorkspaceShellOrganizationId).not.toHaveBeenCalled()
  })
})

describe('the shell scope outside a named organization', () => {
  it('opens in the landing organization, provisioned for an account in none', async () => {
    headerValue.current = null
    expect(await readShellOrganizationId()).toBe('landing-org')
    expect(resolveOrProvisionLandingOrganization).toHaveBeenCalledWith('viewer')
  })

  it('opens a named organization without reading the viewer’s landing', async () => {
    headerValue.current = 'org:team-org'
    expect(await readShellOrganizationId()).toBe('team-org')
    expect(resolveOrProvisionLandingOrganization).not.toHaveBeenCalled()
  })
})
