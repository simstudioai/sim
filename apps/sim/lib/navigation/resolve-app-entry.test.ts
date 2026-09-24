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

import {
  resolveAppEntryPath,
  resolveOrganizationEntryPath,
} from '@/lib/navigation/resolve-app-entry'

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

  it('lands an organization member on the workspace picker when Search is disabled', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('org-2')
    mockSearchAvailable.mockResolvedValue(false)
    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe('/workspace')
  })

  it('lands a viewer with no organization on the workspace picker', async () => {
    mockResolveOrganizationLanding.mockResolvedValue(null)

    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe('/workspace')
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', null)
    expect(mockSearchAvailable).not.toHaveBeenCalled()
  })
})

describe('resolveOrganizationEntryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchAvailable.mockResolvedValue(true)
  })

  it('uses the authenticated viewer membership independently of the workspace host', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('viewer-organization')
    const session = {
      user: { id: 'viewer' },
      session: { activeOrganizationId: 'viewer-organization' },
    }

    await expect(resolveOrganizationEntryPath(session)).resolves.toBe('/o/viewer-organization/home')
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', 'viewer-organization')
    expect(mockSearchAvailable).toHaveBeenCalledWith({ organizationId: 'viewer-organization' })
  })

  it('returns no organization destination for a nonmember with a stale active organization', async () => {
    mockResolveOrganizationLanding.mockResolvedValue(null)
    const session = {
      user: { id: 'viewer' },
      session: { activeOrganizationId: 'former-organization' },
    }

    await expect(resolveOrganizationEntryPath(session)).resolves.toBeNull()
    expect(mockResolveOrganizationLanding).toHaveBeenCalledWith('viewer', 'former-organization')
    expect(mockSearchAvailable).not.toHaveBeenCalled()
  })

  it('returns no organization destination when the member organization has Search disabled', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('viewer-organization')
    mockSearchAvailable.mockResolvedValue(false)

    await expect(resolveOrganizationEntryPath({ user: { id: 'viewer' } })).resolves.toBeNull()
  })

  it('propagates membership lookup failures', async () => {
    mockResolveOrganizationLanding.mockRejectedValue(new Error('Membership lookup failed'))

    await expect(resolveOrganizationEntryPath({ user: { id: 'viewer' } })).rejects.toThrow(
      'Membership lookup failed'
    )
    expect(mockSearchAvailable).not.toHaveBeenCalled()
  })
})
