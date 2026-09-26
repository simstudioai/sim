import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOrganizationLanding } = vi.hoisted(() => ({
  mockResolveOrganizationLanding: vi.fn(),
}))

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/organizations/surface', () => ({
  resolveOrganizationLanding: mockResolveOrganizationLanding,
}))

import {
  resolveAppEntryPath,
  resolveOrganizationEntryPath,
} from '@/lib/navigation/resolve-app-entry'

const mockSearchAvailable = knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable

describe('resolveAppEntryPath', () => {
  beforeEach(() => {
    mockSearchAvailable.mockResolvedValue(true)
  })

  it('lands an organization member on the workspace picker when Search is disabled', async () => {
    mockResolveOrganizationLanding.mockResolvedValue('org-2')
    mockSearchAvailable.mockResolvedValue(false)
    await expect(resolveAppEntryPath({ user: { id: 'viewer' } })).resolves.toBe('/workspace')
  })
})

describe('resolveOrganizationEntryPath', () => {
  beforeEach(() => {
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
})
