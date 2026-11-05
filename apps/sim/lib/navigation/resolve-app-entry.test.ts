import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveOrganizationLanding } = vi.hoisted(() => ({
  mockResolveOrganizationLanding: vi.fn(),
}))

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/organizations/surface', () => ({
  resolveOrganizationLanding: mockResolveOrganizationLanding,
}))

vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

import {
  resolveAppEntryPath,
  resolveOrganizationEntryPath,
  resolveWorkspacelessMemberPath,
} from '@/lib/navigation/resolve-app-entry'

const mockSearchAvailable = knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable
const { mockGetWorkspaceCreationPolicy } = workspacesPolicyMockFns
const { mockListAccessibleWorkspaceRowsForUser: mockListWorkspaces } = workspacesUtilsMockFns

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

describe('resolveWorkspacelessMemberPath', () => {
  const session = { user: { id: 'viewer' } }

  beforeEach(() => {
    mockResolveOrganizationLanding.mockResolvedValue('org-1')
    mockSearchAvailable.mockResolvedValue(true)
    mockGetWorkspaceCreationPolicy.mockResolvedValue({ canCreate: false })
    mockListWorkspaces.mockResolvedValue([])
  })

  it('forwards a member who has no workspace and cannot create one', async () => {
    await expect(resolveWorkspacelessMemberPath(session, 'home')).resolves.toBe('/o/org-1/home')
    await expect(resolveWorkspacelessMemberPath(session, 'settings')).resolves.toBe(
      '/o/org-1/settings/general'
    )
  })

  it('stays on the picker when the organization surface would send the viewer back', async () => {
    mockSearchAvailable.mockResolvedValue(false)
    await expect(resolveWorkspacelessMemberPath(session, 'home')).resolves.toBeNull()
  })

  it('stays on the picker for a viewer with no organization', async () => {
    mockResolveOrganizationLanding.mockResolvedValue(null)
    await expect(resolveWorkspacelessMemberPath(session, 'home')).resolves.toBeNull()
  })

  it('keeps a member who has a workspace on the picker', async () => {
    mockListWorkspaces.mockResolvedValue([{ workspace: { id: 'ws-1' } }])
    await expect(resolveWorkspacelessMemberPath(session, 'home')).resolves.toBeNull()
  })

  it('leaves a member who can create a workspace to the default-workspace path', async () => {
    mockGetWorkspaceCreationPolicy.mockResolvedValue({ canCreate: true })
    await expect(resolveWorkspacelessMemberPath(session, 'home')).resolves.toBeNull()
  })
})
