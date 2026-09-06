/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOrganizationLanding } = vi.hoisted(() => ({
  mockResolveOrganizationLanding: vi.fn(),
}))

vi.mock('@/lib/organizations/surface', () => ({
  resolveOrganizationLanding: mockResolveOrganizationLanding,
}))

import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

describe('resolveAppEntryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lands an organization member on that organization home', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('org-2')

    await expect(
      resolveAppEntryPath({
        user: { id: 'viewer' },
        session: { activeOrganizationId: 'org-2' },
      })
    ).resolves.toBe('/o/org-2/home')
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', 'org-2')
  })

  it('lands a viewer with no organization on the workspace picker', async () => {
    mockResolveOrganizationLanding.mockResolvedValue(null)

    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe('/workspace')
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', null)
  })
})
