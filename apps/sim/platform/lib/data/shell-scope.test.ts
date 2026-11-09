/**
 * @vitest-environment node
 *
 * The workspace layout authorizes with this read and the shell renders the organization it names.
 * Failure modes: a `/workspace/<id>` shell resolving the workspace for someone other than the
 * signed-in viewer, or rendering an organization for a workspace the viewer cannot open; a database
 * failure read as "cannot open" (a 404 for a workspace the viewer owns); and a shell outside any
 * named organization finding none for an account in no organization (access denied on every page)
 * instead of provisioning their personal one. Which organization a workspace opens in, and the
 * provisioning itself, are proven in `personal-organization-shell.integration.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'

const { readWorkspaceShell, ensureViewerOrganization, headerValue, REFUSAL } = vi.hoisted(() => ({
  REFUSAL: new Error('Workspace not found'),
  readWorkspaceShell: { execute: vi.fn() },
  ensureViewerOrganization: { execute: vi.fn() },
  headerValue: { current: null as string | null },
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(headerValue.current ? { 'x-sim-shell-scope': headerValue.current } : {}),
}))
vi.mock('@/lib/workspaces/application/workspace-shell', () => ({
  readWorkspaceShell,
  isWorkspaceShellRefusal: (error: unknown) => error === REFUSAL,
}))
vi.mock('@/lib/organizations/application/viewer-organization', () => ({
  ensureViewerOrganization,
}))

import {
  readShellOrganizationId,
  readWorkspaceShellOrganizationId,
} from '@/platform/lib/data/shell-scope'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>
const PRINCIPAL = { kind: 'session', userId: 'viewer', sessionId: 'session-1' }

beforeEach(() => {
  readWorkspaceShell.execute.mockReset()
  ensureViewerOrganization.execute.mockReset().mockResolvedValue('landing-org')
  vi.mocked(getSession).mockResolvedValue(SESSION)
  headerValue.current = 'workspace:ws-1'
})

describe('the shell scope of a workspace URL', () => {
  it('renders the organization the workspace opens in for the signed-in viewer', async () => {
    readWorkspaceShell.execute.mockResolvedValue({ organizationId: 'viewer-org' })
    expect(await readShellOrganizationId()).toBe('viewer-org')
    expect(readWorkspaceShell.execute).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: 'ws-1' },
    })
    expect(ensureViewerOrganization.execute).not.toHaveBeenCalled()
  })

  it("leaves the shell in the viewer's landing organization for a workspace they cannot open", async () => {
    readWorkspaceShell.execute.mockRejectedValue(REFUSAL)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(await readShellOrganizationId()).toBe('landing-org')
  })

  it('fails the read when the workspace lookup itself fails', async () => {
    readWorkspaceShell.execute.mockRejectedValue(new Error('connection terminated'))
    await expect(readWorkspaceShellOrganizationId('ws-1')).rejects.toThrow('connection terminated')
  })

  it('provisions an organization for a viewer who can open the workspace but belongs to none', async () => {
    readWorkspaceShell.execute.mockResolvedValue({ organizationId: null })
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBe('landing-org')
    expect(ensureViewerOrganization.execute).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {},
    })
  })

  it('opens nothing for a signed-out request', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(readWorkspaceShell.execute).not.toHaveBeenCalled()
  })
})

describe('the shell scope outside a named organization', () => {
  it('opens in the landing organization, provisioned for an account in none', async () => {
    headerValue.current = null
    expect(await readShellOrganizationId()).toBe('landing-org')
    expect(ensureViewerOrganization.execute).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {},
    })
  })

  it('opens a named organization without reading the viewer’s landing', async () => {
    headerValue.current = 'org:team-org'
    expect(await readShellOrganizationId()).toBe('team-org')
    expect(ensureViewerOrganization.execute).not.toHaveBeenCalled()
  })
})
