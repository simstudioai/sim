/**
 * @vitest-environment node
 *
 * Failure modes: a saved link to an organization-less workspace's moved page (a personal workspace
 * kept outside the team its owner joined) answering not found, or landing in an organization other
 * than the viewer's; and a workspace the viewer cannot open disclosing an organization.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession } from '@/lib/auth'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const { checkWorkspaceAccess, resolveOrganizationLanding } = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
  resolveOrganizationLanding: vi.fn(),
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
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess }))
vi.mock('@/lib/organizations/surface', () => ({ resolveOrganizationLanding }))

import { redirectLegacyWorkspaceUrl } from '@/platform/lib/data/legacy-redirects'

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
})

describe('redirectLegacyWorkspaceUrl for an organization-less workspace', () => {
  it.each([
    [['home'], {}, '/o/viewer-org/home'],
    [['chat', 'chat-1'], {}, '/o/viewer-org/chat/chat-1'],
    [['skills'], {}, '/o/viewer-org/integrations?tab=skills&workspace=ws-1'],
    [['integrations'], {}, '/o/viewer-org/integrations'],
    [['upgrade'], { reason: 'credits' }, '/o/viewer-org/settings/billing/plans?reason=credits'],
  ])("sends /workspace/ws-1/%s to the viewer's organization", async (segments, query, target) => {
    checkWorkspaceAccess.mockResolvedValue(access(null))
    await expect(redirectLegacyWorkspaceUrl('ws-1', segments, query)).rejects.toThrow(
      `redirect ${target}`
    )
  })

  it("keeps a workspace in an organization on its own organization's pages", async () => {
    checkWorkspaceAccess.mockResolvedValue(access('team-org'))
    await expect(redirectLegacyWorkspaceUrl('ws-1', ['home'], {})).rejects.toThrow(
      'redirect /o/team-org/home'
    )
  })

  it('answers not found for an organization-less workspace the viewer cannot open', async () => {
    checkWorkspaceAccess.mockResolvedValue(access(null, false))
    await expect(redirectLegacyWorkspaceUrl('ws-1', ['home'], {})).rejects.toThrow('not found')
  })
})
