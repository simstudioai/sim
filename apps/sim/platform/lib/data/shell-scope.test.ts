/**
 * @vitest-environment node
 *
 * The workspace layout authorizes with this read and the shell renders the organization it names.
 * Failure modes: a `/workspace/<id>` shell resolving the workspace for someone other than the
 * signed-in viewer, or rendering an organization for a workspace the viewer cannot open. Which
 * organization a workspace opens in is `resolveWorkspaceShellOrganizationId`'s own test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'

const { resolveWorkspaceShellOrganizationId, headerValue } = vi.hoisted(() => ({
  resolveWorkspaceShellOrganizationId: vi.fn(),
  headerValue: { current: null as string | null },
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(headerValue.current ? { 'x-sim-shell-scope': headerValue.current } : {}),
}))
vi.mock('@/lib/workspaces/shell-organization', () => ({ resolveWorkspaceShellOrganizationId }))

import {
  readShellOrganizationId,
  readWorkspaceShellOrganizationId,
} from '@/platform/lib/data/shell-scope'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  resolveWorkspaceShellOrganizationId.mockReset()
  vi.mocked(getSession).mockResolvedValue(SESSION)
  headerValue.current = 'workspace:ws-1'
})

describe('the shell scope of a workspace URL', () => {
  it('renders the organization the workspace opens in for the signed-in viewer', async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue('viewer-org')
    expect(await readShellOrganizationId()).toBe('viewer-org')
    expect(resolveWorkspaceShellOrganizationId).toHaveBeenCalledWith('ws-1', 'viewer')
  })

  it('leaves the shell unscoped for a workspace the viewer cannot open', async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue(null)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(await readShellOrganizationId()).toBeUndefined()
  })

  it('opens nothing for a signed-out request', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await readWorkspaceShellOrganizationId('ws-1')).toBeNull()
    expect(resolveWorkspaceShellOrganizationId).not.toHaveBeenCalled()
  })
})
