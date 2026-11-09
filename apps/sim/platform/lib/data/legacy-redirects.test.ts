/**
 * @vitest-environment node
 *
 * Failure modes: a moved workspace URL redirecting into an organization other than the one the
 * workspace opens in for the viewer (an organization-less workspace opens in the viewer's own), or
 * disclosing an organization for a workspace the viewer cannot open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'

const { resolveWorkspaceShellOrganizationId } = vi.hoisted(() => ({
  resolveWorkspaceShellOrganizationId: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
  permanentRedirect: (target: string) => {
    throw new Error(`redirect ${target}`)
  },
  redirect: (target: string) => {
    throw new Error(`redirect ${target}`)
  },
}))
vi.mock('@/lib/workspaces/shell-organization', () => ({ resolveWorkspaceShellOrganizationId }))

import { redirectLegacyWorkspaceUrl } from '@/platform/lib/data/legacy-redirects'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  resolveWorkspaceShellOrganizationId.mockReset()
  vi.mocked(getSession).mockResolvedValue(SESSION)
})

describe('redirectLegacyWorkspaceUrl', () => {
  it('redirects into the organization the workspace opens in for the viewer', async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue('viewer-org')
    await expect(
      redirectLegacyWorkspaceUrl('ws-1', ['upgrade'], { reason: 'credits' })
    ).rejects.toThrow('redirect /o/viewer-org/settings/billing/plans?reason=credits')
    expect(resolveWorkspaceShellOrganizationId).toHaveBeenCalledWith('ws-1', 'viewer')
  })

  it('answers not found for a workspace the viewer cannot open', async () => {
    resolveWorkspaceShellOrganizationId.mockResolvedValue(null)
    await expect(redirectLegacyWorkspaceUrl('ws-1', ['home'], {})).rejects.toThrow('not found')
  })
})
