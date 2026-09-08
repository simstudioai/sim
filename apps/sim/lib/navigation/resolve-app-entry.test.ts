/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOrganizationLanding, mockSearchAvailable } = vi.hoisted(() => ({
  mockResolveOrganizationLanding: vi.fn(),
  mockSearchAvailable: vi.fn(),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mockSearchAvailable,
}))

vi.mock('@/lib/organizations/surface', () => ({
  resolveOrganizationLanding: mockResolveOrganizationLanding,
}))

import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

describe('resolveAppEntryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchAvailable.mockResolvedValue(true)
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
    expect(mockSearchAvailable).toHaveBeenCalledWith({ organizationId: 'org-2' })
  })

  it('opens full workspace settings when Search is disabled', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('org-2')
    mockSearchAvailable.mockResolvedValue(false)
    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe(
      '/workspace?redirect=settings'
    )
  })

  it('lands a viewer with no organization on the workspace picker', async () => {
    mockResolveOrganizationLanding.mockResolvedValue(null)

    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe('/workspace')
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', null)
    expect(mockSearchAvailable).not.toHaveBeenCalled()
  })
})
