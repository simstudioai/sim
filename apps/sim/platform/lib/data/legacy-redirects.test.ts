/**
 * @vitest-environment node
 *
 * Failure modes: a moved workspace URL redirecting into an organization other than the one the
 * workspace opens in for the viewer (an organization-less workspace opens in the viewer's own), or
 * disclosing an organization for a workspace the viewer cannot open.
 */
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'

const { readWorkspaceShellOrganizationId } = vi.hoisted(() => ({
  readWorkspaceShellOrganizationId: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/platform/lib/data/shell-scope', () => ({ readWorkspaceShellOrganizationId }))

import { redirectLegacyWorkspaceUrl } from '@/platform/lib/data/legacy-redirects'

const SESSION = { user: { id: 'viewer' }, session: { id: 'session-1' } } as NonNullable<
  Awaited<ReturnType<typeof getSession>>
>

beforeEach(() => {
  readWorkspaceShellOrganizationId.mockReset()
  vi.mocked(getSession).mockResolvedValue(SESSION)
})

describe('redirectLegacyWorkspaceUrl', () => {
  it('redirects into the organization the workspace opens in for the viewer', async () => {
    readWorkspaceShellOrganizationId.mockResolvedValue('viewer-org')
    await expect(
      redirectLegacyWorkspaceUrl('ws-1', ['upgrade'], { reason: 'credits' })
    ).rejects.toThrow('NEXT_REDIRECT:/o/viewer-org/settings/billing/plans?reason=credits')
    expect(readWorkspaceShellOrganizationId).toHaveBeenCalledWith('ws-1')
  })

  it('answers not found for a workspace the viewer cannot open', async () => {
    readWorkspaceShellOrganizationId.mockResolvedValue(null)
    await expect(redirectLegacyWorkspaceUrl('ws-1', ['home'], {})).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
